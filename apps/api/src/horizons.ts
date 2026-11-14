import { parse } from 'csv-parse/browser/esm/sync';
import type { HorizonQuery, Position, Positions } from '@lunar-lense/contracts';
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

export function queryParameters(query: HorizonQuery, targetId: string): URLSearchParams {
  const settings = {
    COMMAND: targetId,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: 'coord@301',
    COORD_TYPE: 'GEODETIC',
    SITE_COORD: `${query.longitude},${query.latitude},0`,
    TLIST: `${query.date} 00:00:00`,
    TLIST_TYPE: 'CAL',
    TIME_TYPE: 'UT',
    CAL_TYPE: 'GREGORIAN',
    TIME_DIGITS: 'SECONDS',
    QUANTITIES: '4',
    APPARENT: 'AIRLESS',
    CSV_FORMAT: 'YES',
    ELEV_CUT: '-90',
  };
  return new URLSearchParams({
    format: 'json',
    ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [key, `'${value}'`])),
  });
}

export function parsePosition(payload: unknown, name: string): Position {
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
    if (!header || rows.length !== 1) throw new Error('expected exactly one time sample');
    const row = rows[0]!;
    const az = row[header.indexOf('Azi_(a-app)')];
    const el = row[header.indexOf('Elev_(a-app)')];
    if (!az || !el) throw new Error('missing angles');
    const azimuth = Number(az);
    const elevation = Number(el);
    if (!Number.isFinite(azimuth) || azimuth < 0 || azimuth > 360
      || !Number.isFinite(elevation) || elevation < -90 || elevation > 90) {
      throw new Error('invalid angles');
    }
    return { azimuthDeg: azimuth % 360, elevationDeg: elevation, isVisible: elevation >= 0 };
  } catch {
    throw new HorizonsError(`Cannot read ${name}'s azimuth and elevation from Horizons.`);
  }
}

export function createHorizonsClient(fetcher: typeof fetch = fetch, timeoutMs = 45_000) {
  // Serializes both bodies and callers within one Worker instance only.
  // Public use needs shared coordination across instances to satisfy JPL's policy.
  let pending: Promise<unknown> = Promise.resolve();

  async function fetchPosition(query: HorizonQuery, name: string, targetId: string) {
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
      return parsePosition(await response.json(), name);
    } catch (error) {
      if (error instanceof HorizonsError) throw error;
      if (signal.aborted) throw new HorizonsError(`Horizons timed out while fetching ${name}.`, 504);
      throw new HorizonsError(`Cannot fetch a valid Horizons response for ${name}.`);
    }
  }

  return (query: HorizonQuery): Promise<Positions> => {
    const result = pending.then(async () => {
      const earth = await fetchPosition(query, 'Earth', '399');
      const sun = await fetchPosition(query, 'Sun', '10');
      return { earth, sun };
    });
    // An upstream failure must not block subsequent requests.
    pending = result.catch(() => undefined);
    return result;
  };
}
