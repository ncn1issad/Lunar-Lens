import { parse } from 'csv-parse/browser/esm/sync';
import type { HorizonQuery, Position, Positions, TimelineEphemerisQuery, TimelinePositions, TimedPosition } from '@lunar-lense/contracts';
import { timelineSampleCount } from './timeline-query.js';
export type { HorizonQuery, Position, Positions } from '@lunar-lense/contracts';

const API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

export class HorizonsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 502 | 504 = 502,
  ) {
    super(message);
    this.name = 'HorizonsError';
  }
}

export function queryParameters(query: HorizonQuery | TimelineEphemerisQuery, targetId: string): URLSearchParams {
  const timeSettings = 'date' in query
    ? { TLIST: `${query.date} 00:00:00`, TLIST_TYPE: 'CAL' }
    : {
      START_TIME: query.start.replace('T', ' ').replace('Z', ''),
      STOP_TIME: query.end.replace('T', ' ').replace('Z', ''),
      STEP_SIZE: `${query.stepMinutes} min`,
      CAL_FORMAT: 'CAL',
    };
  const settings = {
    COMMAND: targetId,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${query.longitude},${query.latitude},${'altitudeKm' in query ? query.altitudeKm : 0}`,
    TIME_TYPE: 'UT',
    CAL_TYPE: 'GREGORIAN',
    TIME_DIGITS: 'SECONDS',
    QUANTITIES: '4',
    APPARENT: 'AIRLESS',
    CSV_FORMAT: 'YES',
    ELEV_CUT: '-90',
    ...timeSettings,
  };
  return new URLSearchParams({
    format: 'json',
    ...Object.fromEntries(Object.entries(settings)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, `'${value}'`])),
  });
}

function readTable(payload: unknown, name: string): { header: string[]; rows: string[][]; preamble: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HorizonsError(`Horizons returned unexpected JSON for ${name}.`);
  }
  const data = payload as Record<string, unknown>;
  if (data.error || typeof data.result !== 'string') {
    throw new HorizonsError(`Horizons returned no usable ephemeris for ${name}.`);
  }
  const start = data.result.indexOf('$$SOE');
  const end = data.result.indexOf('$$EOE', start + 5);
  if (start < 0 || end < 0) {
    throw new HorizonsError(`Horizons returned no ephemeris table for ${name}.`);
  }

  try {
    const headerLine = data.result.slice(0, start).split(/\r?\n/).reverse()
      .find((line) => line.includes('Azi_(a-app)'));
    if (!headerLine) throw new Error('missing column labels');
    const options = { trim: true, skip_empty_lines: true };
    const [header] = parse(headerLine, options) as string[][];
    const rows = parse(data.result.slice(start + 5, end).trim(), options) as string[][];
    if (!header || rows.length === 0 || rows.some((row) => row.length !== header.length)
      || header.filter((column) => column === 'Azi_(a-app)').length !== 1
      || header.filter((column) => column === 'Elev_(a-app)').length !== 1) {
      throw new Error('invalid table');
    }
    return { header, rows, preamble: data.result.slice(0, start) };
  } catch {
    throw new HorizonsError(`Cannot read ${name}'s azimuth and elevation from Horizons.`);
  }
}

function readPosition(header: string[], row: string[], name: string): Position {
  const az = row[header.indexOf('Azi_(a-app)')];
  const el = row[header.indexOf('Elev_(a-app)')];
  const azimuth = Number(az);
  const elevation = Number(el);
  if (!az || !el || !Number.isFinite(azimuth) || azimuth < 0 || azimuth > 360
    || !Number.isFinite(elevation) || elevation < -90 || elevation > 90) {
    throw new HorizonsError(`Cannot read ${name}'s azimuth and elevation from Horizons.`);
  }
  return { azimuthDeg: azimuth % 360, elevationDeg: elevation, isVisible: elevation >= 0 };
}

export function parsePosition(payload: unknown, name: string): Position {
  const { header, rows } = readTable(payload, name);
  if (rows.length !== 1) throw new HorizonsError(`Expected exactly one time sample for ${name} from Horizons.`);
  return readPosition(header, rows[0]!, name);
}

export function parseTimeline(payload: unknown, name: string, query: TimelineEphemerisQuery): TimedPosition[] {
  const { header, rows, preamble } = readTable(payload, name);
  // Horizons' lunar mean-Earth observer frame is DE421, matching SLDEM2015.
  // Check the response too, since Horizons can fall back to a lower precision model.
  const frame = preamble.match(/^\s*Center pole\/equ\s*:\s*([^\r\n{]+)/m)?.[1]?.trim();
  const radii = preamble.match(/^\s*Center radii\s*:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\s+km/m);
  if (!/^(?:MEAN_ME|MOON_ME)(?:\s+\(high precision\))?$/.test(frame ?? '')
    || !/Center body name:\s*Moon\s*\(301\)/.test(preamble)
    || !radii || radii.slice(1).some(value => Number(value) !== 1737.4)) {
    throw new HorizonsError(`Horizons returned an unsupported lunar observer frame or reference sphere for ${name}.`);
  }
  const timeColumn = header.findIndex((column) => /^Date__\(UT\)__HR:MN:(?:SS|SC)(?:\.fff)?$/.test(column));
  if (timeColumn < 0 || rows.length !== timelineSampleCount(query)) {
    throw new HorizonsError(`Horizons returned an incomplete or unexpected timeline for ${name}.`);
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return rows.map((row, index) => {
    const match = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2})(?:\.0+)?$/.exec(row[timeColumn] ?? '');
    if (!match || !months.includes(match[2]!)) {
      throw new HorizonsError(`Cannot read ${name}'s UTC timestamps from Horizons.`);
    }
    const month = String(months.indexOf(match[2]!) + 1).padStart(2, '0');
    const timestamp = `${match[1]}-${month}-${match[3]}T${match[4]}Z`;
    const expected = new Date(Date.parse(query.start) + index * query.stepMinutes * 60_000)
      .toISOString().replace('.000Z', 'Z');
    if (timestamp !== expected) {
      throw new HorizonsError(`Horizons returned missing, duplicate or unexpected timestamps for ${name}.`);
    }
    return { timestamp, ...readPosition(header, row, name) };
  });
}

export function createHorizonsClient(fetcher: typeof fetch = fetch, timeoutMs = 45_000) {
  // Serializes both bodies and callers within one Worker instance only.
  // Public use needs shared coordination across instances to satisfy JPL's policy.
  let pending: Promise<unknown> = Promise.resolve();

  async function fetchEphemeris(query: HorizonQuery | TimelineEphemerisQuery, name: string, targetId: string): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetcher(`${API_URL}?${queryParameters(query, targetId)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'LunarLense/0.1' },
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new HorizonsError(`Horizons HTTP error ${response.status} while fetching ${name}.`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof HorizonsError) throw error;
      if (signal.aborted) throw new HorizonsError(`Horizons timed out while fetching ${name}.`, 504);
      throw new HorizonsError(`Cannot fetch a valid Horizons response for ${name}.`);
    }
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    // An upstream failure must not block subsequent requests.
    pending = result.catch(() => undefined);
    return result;
  }

  function getPositions(query: HorizonQuery): Promise<Positions> {
    return enqueue(async () => {
      const earth = parsePosition(await fetchEphemeris(query, 'Earth', '399'), 'Earth');
      const sun = parsePosition(await fetchEphemeris(query, 'Sun', '10'), 'Sun');
      return { earth, sun };
    });
  }

  function timeline(query: TimelineEphemerisQuery): Promise<TimelinePositions> {
    return enqueue(async () => {
      const earth = parseTimeline(await fetchEphemeris(query, 'Earth', '399'), 'Earth', query);
      const sun = parseTimeline(await fetchEphemeris(query, 'Sun', '10'), 'Sun', query);
      return { earth, sun };
    });
  }

  // Both endpoints share the same instance-local upstream queue.
  return Object.assign(getPositions, { timeline });
}
