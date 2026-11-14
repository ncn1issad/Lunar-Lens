import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { parse } from 'csv-parse/browser/esm/sync';
import type { ApiError, TimelineQuery, TimelineEphemerisQuery, TimelineResponse } from '@lunar-lense/contracts';
import { buildApp as buildBaseApp } from '../src/app.js';
import { createHorizonsClient, parseTimeline, queryParameters } from '../src/horizons.js';
import { parseTimelineQuery, timelineSampleCount } from '../src/timeline-query.js';
import { getMoonProfile } from '../src/terrain/service.js';
import { terrainVisibility } from '../src/terrain/profile.js';
import { terrainAssets } from './fixtures/terrain-assets.js';

const fixture = async (name: string) => JSON.parse(
  await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
);
const earth = await fixture('timeline-earth');
const sun = await fixture('timeline-sun');
const single = await fixture('earth');
const query: TimelineEphemerisQuery = {
  start: '2026-11-14T00:00:00Z',
  end: '2026-11-14T02:00:00Z',
  stepMinutes: 60,
  longitude: 23.5,
  latitude: -10,
  altitudeKm: 0,
};
const requestQuery: TimelineQuery = {
  start: query.start, end: query.end, stepMinutes: query.stepMinutes,
  longitude: query.longitude, latitude: query.latitude,
  eyeHeightM: 2, azimuthStepDeg: 0.125, maxDistanceM: 480000,
};
const profile = await getMoonProfile(requestQuery, terrainAssets().fetcher);
function buildApp(options: Parameters<typeof buildBaseApp>[0] = {}) {
  return buildBaseApp({ fetchTerrainAsset: terrainAssets().fetcher, ...options });
}
const params = 'start=2026-11-14T00:00:00Z&end=2026-11-14T02:00:00Z&longitude=23.5&latitude=-10';
const url = `/api/timeline?${params}`;
const timestamps = ['2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', '2026-11-14T02:00:00Z'];

function mockClient() {
  const requests: URL[] = [];
  const client = createHorizonsClient(async (input) => {
    const request = new URL(String(input));
    requests.push(request);
    return Response.json(request.searchParams.get('COMMAND') === "'399'" ? earth : sun);
  });
  return { client, requests };
}

test('timeline returns timestamped Earth/Sun tables from two captured NASA responses', async () => {
  const { client, requests } = mockClient();
  const response = await buildApp({ getTimeline: client.timeline }).request(url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/json/);
  assert.equal(response.headers.get('content-disposition'), null);
  const body = await response.json() as TimelineResponse;
  assert.deepEqual(body, {
    timeScale: 'UTC',
    range: { start: query.start, end: query.end, stepMinutes: 60, sampleCount: 3 },
    observer: profile.observer,
    moon: profile.moon,
    visibilityModel: 'terrain',
    positions: {
      earth: [
        { timestamp: timestamps[0], azimuthDeg: 299.177599, elevationDeg: 61.348525, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 299.177599, elevationDeg: 61.348525 }) },
        { timestamp: timestamps[1], azimuthDeg: 299.040550, elevationDeg: 61.320103, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 299.040550, elevationDeg: 61.320103 }) },
        { timestamp: timestamps[2], azimuthDeg: 298.903100, elevationDeg: 61.291640, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 298.903100, elevationDeg: 61.291640 }) },
      ],
      sun: [
        { timestamp: timestamps[0], azimuthDeg: 93.887594, elevationDeg: -12.633272, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 93.887594, elevationDeg: -12.633272 }) },
        { timestamp: timestamps[1], azimuthDeg: 93.792061, elevationDeg: -12.134243, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 93.792061, elevationDeg: -12.134243 }) },
        { timestamp: timestamps[2], azimuthDeg: 93.697007, elevationDeg: -11.635168, ...terrainVisibility(profile.moon.horizon, { azimuthDeg: 93.697007, elevationDeg: -11.635168 }) },
      ],
    },
    source: 'NASA/JPL Horizons',
  });
  assert.deepEqual(requests.map((r) => r.searchParams.get('COMMAND')), ["'399'", "'10'"]);
  for (const request of requests) {
    assert.equal(request.searchParams.get('START_TIME'), "'2026-11-14 00:00:00'");
    assert.equal(request.searchParams.get('STOP_TIME'), "'2026-11-14 02:00:00'");
    assert.equal(request.searchParams.get('STEP_SIZE'), "'60 min'");
    assert.equal(request.searchParams.get('SITE_COORD'), "'23.5,-10,0.102'");
    assert.equal(request.searchParams.get('TIME_TYPE'), "'UT'");
    assert.equal(request.searchParams.get('CAL_TYPE'), "'GREGORIAN'");
    assert.equal(request.searchParams.get('CAL_FORMAT'), "'CAL'");
    assert.equal(request.searchParams.get('ELEV_CUT'), "'-90'");
    assert.equal(request.searchParams.has('TLIST'), false);
    assert.equal(request.searchParams.has('TLIST_TYPE'), false);
  }
});

test('CSV flag downloads the same timestamped data and observer metadata as JSON', async () => {
  const { client, requests } = mockClient();
  const app = buildApp({ getTimeline: client.timeline });
  const body = await (await app.request(`${url}&eyeHeightM=10&format=json`)).json() as TimelineResponse;
  const response = await app.request(`${url}&eyeHeightM=10&format=csv`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(response.headers.get('content-disposition'),
    'attachment; filename="lunar-lense-timeline-2026-11-14-2026-11-14.csv"');
  const csv = await response.text();
  assert.ok(csv.endsWith('\r\n'));
  const rows = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  assert.equal(rows.length, 3);
  rows.forEach((row, index) => {
    const earthPosition = body.positions.earth[index]!;
    const sunPosition = body.positions.sun[index]!;
    assert.equal(row.timestamp, earthPosition.timestamp);
    assert.equal(row.timestamp, sunPosition.timestamp);
    assert.equal(row.timeScale, body.timeScale);
    assert.equal(Number(row.longitudeDeg), body.observer.longitudeDeg);
    assert.equal(Number(row.latitudeDeg), body.observer.latitudeDeg);
    assert.equal(Number(row.altitudeKm), 0.11);
    assert.equal(Number(row.groundElevationM), 100);
    assert.equal(Number(row.eyeHeightM), 10);
    assert.equal(row.visibilityModel, 'terrain');
    assert.equal(row.terrainDatasetId, body.moon.terrain.id);
    assert.equal(row.terrainReferenceFrame, 'MOON_ME_DE421');
    assert.equal(Number(row.azimuthStepDeg), body.moon.calculation.azimuthStepDeg);
    assert.equal(Number(row.maxDistanceM), body.moon.calculation.maxDistanceM);
    for (const [name, position] of [['earth', earthPosition], ['sun', sunPosition]] as const) {
      assert.equal(Number(row[`${name}AzimuthDeg`]), position.azimuthDeg);
      assert.equal(Number(row[`${name}ElevationDeg`]), position.elevationDeg);
      assert.equal(row[`${name}IsVisible`], String(position.isVisible));
      assert.equal(Number(row[`${name}TerrainHorizonElevationDeg`]), position.terrainHorizonElevationDeg);
    }
  });
  // No persistent cache: each explicit export/request performs one range call per body.
  assert.equal(requests.length, 4);
  assert.ok(requests.every((r) => r.searchParams.get('SITE_COORD') === "'23.5,-10,0.11'"));
});

test('timeline uses terrain for visibility, including obstructions, negative skylines and north wraparound', async () => {
  // Ground rises northward, so north has a positive skyline and south a negative one.
  const terrain = terrainAssets(latitude => 100 + (latitude + 10) * 1000);
  let upstreamCalls = 0;
  const app = buildApp({
    fetchTerrainAsset: terrain.fetcher,
    getTimeline: async input => {
      upstreamCalls++;
      assert.equal(input.altitudeKm, 0.102);
      assert.equal(input.longitude, 23.5);
      assert.equal(input.latitude, -10);
      assert.equal(terrain.requested.filter(path => path.endsWith('manifest.json')).length, 2);
      return {
        earth: timestamps.map((timestamp, index) => ({
          timestamp, azimuthDeg: [0, 359.9, 0.1][index]!, elevationDeg: 1, isVisible: true,
        })),
        sun: timestamps.map(timestamp => ({ timestamp, azimuthDeg: 180, elevationDeg: -0.01, isVisible: false })),
      };
    },
  });
  const response = await app.request(url);
  assert.equal(response.status, 200);
  const body = await response.json() as TimelineResponse;
  assert.ok(body.positions.earth.every(p => p.terrainHorizonElevationDeg > 1 && !p.isVisible));
  assert.ok(body.positions.sun.every(p => p.terrainHorizonElevationDeg < -0.01 && p.isVisible));
  assert.equal(upstreamCalls, 1);
  assert.equal(terrain.requested.length, new Set(terrain.requested).size, 'each terrain tile loads once for all timestamps');
  // The independently requested /api/moon profile has exactly the same observer and skyline.
  const moon = await (await app.request('/api/moon?longitude=23.5&latitude=-10')).json();
  assert.deepEqual(moon, { observer: body.observer, moon: body.moon });
});

test('a body exactly on the interpolated terrain skyline is visible in JSON and CSV', async () => {
  const azimuthDeg = 359.75;
  const { terrainHorizonElevationDeg } = terrainVisibility(profile.moon.horizon, { azimuthDeg, elevationDeg: 0 });
  const rows = timestamps.map(timestamp => ({
    timestamp, azimuthDeg, elevationDeg: terrainHorizonElevationDeg, isVisible: false,
  }));
  const app = buildApp({ getTimeline: async () => ({ earth: rows, sun: rows }) });
  const body = await (await app.request(url)).json() as TimelineResponse;
  assert.ok(body.positions.earth.every(p => p.isVisible));
  assert.ok(body.positions.sun.every(p => p.isVisible));
  const csv = await (await app.request(`${url}&format=csv`)).text();
  const exported = parse(csv, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  assert.ok(exported.every(row => row.earthIsVisible === 'true' && row.sunIsVisible === 'true'));
});

test('terrain failures return explicit JSON errors before any NASA call, without flat-horizon fallback', async () => {
  let upstreamCalls = 0;
  const getTimeline = async () => { upstreamCalls++; throw new Error('must not reach NASA'); };
  const app = buildApp({ getTimeline, fetchTerrainAsset: async () => new Response(null, { status: 404 }) });
  for (const coordinates of ['longitude=0&latitude=0', 'longitude=0&latitude=70']) {
    const response = await app.request(`/api/timeline?start=2026-11-14&end=2026-11-15&${coordinates}&format=csv`);
    assert.equal(response.status, 503);
    assert.equal((await response.json() as ApiError).error.code, 'TERRAIN_UNAVAILABLE');
    assert.equal(response.headers.get('content-disposition'), null);
  }
  const noData = buildApp({ getTimeline, fetchTerrainAsset: terrainAssets(() => NaN).fetcher });
  const missing = await noData.request(url);
  assert.equal(missing.status, 422);
  assert.equal((await missing.json() as ApiError).error.code, 'TERRAIN_MISSING_DATA');
  const brokenAssets = buildApp({ getTimeline, fetchTerrainAsset: async () => new Response(null, { status: 404 }) });
  const unavailable = await brokenAssets.request(url);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json() as ApiError).error.code, 'TERRAIN_UNAVAILABLE');
  const noBinding = buildBaseApp({ getTimeline });
  assert.equal((await noBinding.request(url)).status, 503);
  assert.equal(upstreamCalls, 0);
});

test('timeline validation normalizes dates and bounds range, steps, sample count and terrain settings', () => {
  const parseQuery = (overrides: Record<string, string>) => {
    const values = new URLSearchParams(params);
    for (const [key, value] of Object.entries(overrides)) values.set(key, value);
    return parseTimelineQuery(values).query;
  };
  assert.deepEqual(parseQuery({ start: '2026-11-14', end: '2026-11-14T02:00:00Z' }), requestQuery);
  assert.equal(timelineSampleCount(parseQuery({ end: '2026-11-14T02:30:00Z' })), 3);
  assert.equal(timelineSampleCount(parseQuery({ end: '2026-11-14T00:01:00Z' })), 1);
  assert.equal(timelineSampleCount(parseQuery({
    start: '2026-01-01', end: '2026-01-07T22:39:00Z', stepMinutes: '1',
  })), 10_000);
  assert.equal(timelineSampleCount(parseQuery({ start: '2024-01-01', end: '2025-01-01' })), 8785);
  assert.equal(parseQuery({ start: '1962-01-01', end: '1962-01-02' }).start, '1962-01-01T00:00:00Z');
  for (const eyeHeightM of [0.1, 10]) {
    assert.equal(parseQuery({ eyeHeightM: String(eyeHeightM) }).eyeHeightM, eyeHeightM);
  }
  const explicit = parseQuery({ eyeHeightM: '10', stepMinutes: '30', longitude: '360', latitude: '-90' });
  assert.equal(queryParameters({ ...explicit, altitudeKm: -1.5 }, '399').get('SITE_COORD'), "'360,-90,-1.5'");
  assert.equal(queryParameters({ ...explicit, altitudeKm: -1.5 }, '399').get('STEP_SIZE'), "'30 min'");
  assert.equal(parseQuery({ start: '2649-01-01', end: '2649-01-02' }).end, '2649-01-02T00:00:00Z');
});

test('invalid timeline requests fail before any upstream call, including CSV requests', async () => {
  let calls = 0;
  const app = buildApp({ getTimeline: async () => { calls++; throw new Error('must not reach upstream'); } });
  const invalid: Record<string, string>[] = [
    { start: '' }, { end: '' },
    { start: '2026-02-30' }, { start: '2025-02-29' }, { start: '0000-01-01' },
    { start: '1961-12-31' }, { start: '2026-1-01' }, { start: '2026-11-14T24:00:00Z' },
    { start: '2026-11-14T00:00:60Z' }, { start: '2026-11-14T00:00:00' },
    { start: '2026-11-14T00:00:00+02:00' }, { start: '2026-11-14T00:00:00.001Z' },
    { start: '2026-11-14T02:00:00Z' }, { start: '2026-11-15' },
    { end: '2027-11-16' }, { end: '10000-01-01' },
    { start: '2650-01-01', end: '2650-01-02' }, { end: '2650-01-01' },
    { start: '2026-01-01', end: '2026-01-07T22:40:00Z', stepMinutes: '1' },
    { stepMinutes: '0' }, { stepMinutes: '-1' }, { stepMinutes: '1.5' },
    { stepMinutes: '527041' }, { stepMinutes: '' }, { stepMinutes: 'NaN' },
    { longitude: '361' }, { longitude: '-181' }, { latitude: '91' }, { latitude: '-91' },
    { longitude: '0x10' }, { longitude: '' }, { latitude: ' ' },
    { altitudeKm: '-20.1' }, { altitudeKm: '100.1' }, { altitudeKm: 'Infinity' }, { altitudeKm: '' },
    { altitudeKm: '0' }, { eyeHeightM: '0' }, { eyeHeightM: '10.001' },
    { azimuthStepDeg: '7' }, { azimuthStepDeg: '0.1' },
    { maxDistanceM: '99' }, { maxDistanceM: '480001' },
    { format: 'xml' }, { format: '' }, { unexpected: '1' },
  ];
  const invalidParams = invalid.map((changes) => {
    const values = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) values.set(key, value);
    return values.toString();
  });
  invalidParams.push('', 'start=2026-11-14');
  for (const key of ['start', 'end', 'latitude', 'longitude', 'eyeHeightM', 'azimuthStepDeg', 'maxDistanceM', 'stepMinutes', 'format']) {
    const value = new URLSearchParams(params).get(key) ?? '1';
    const repeated = new URLSearchParams(params);
    repeated.delete(key);
    repeated.append(key, value);
    repeated.append(key, value);
    invalidParams.push(repeated.toString());
  }
  for (const querystring of invalidParams) {
    const response = await app.request(`/api/timeline?${querystring}`);
    assert.equal(response.status, 400, querystring);
    assert.equal((await response.json() as ApiError).error.code, 'INVALID_INPUT');
    assert.equal(response.headers.get('content-disposition'), null);
  }
  const invalidCsv = await app.request(`${url}&stepMinutes=0&format=csv`);
  assert.equal(invalidCsv.status, 400);
  assert.match(invalidCsv.headers.get('content-type')!, /application\/json/);
  assert.equal(calls, 0);
});

test('timeline parser uses column labels and handles Gregorian day/year rollovers', () => {
  const result = [
    'Center body name: Moon (301)',
    'Center pole/equ : MEAN_ME (high precision) {East-longitude positive}',
    'Center radii : 1737.4, 1737.4, 1737.4 km',
    ' Date__(UT)__HR:MN:SS, , , Elev_(a-app), Azi_(a-app),',
    '$$SOE',
    '2024-Dec-31 23:30:00.000, , , -1, 360,',
    '2025-Jan-01 00:00:00.000, , , 0, 10,',
    '2025-Jan-01 00:30:00.000, , , 1, 20,',
    '$$EOE',
  ].join('\n');
  const positions = parseTimeline({ result }, 'Sun', {
    ...query, start: '2024-12-31T23:30:00Z', end: '2025-01-01T00:30:00Z', stepMinutes: 30,
  });
  assert.deepEqual(positions.map((p) => p.timestamp), [
    '2024-12-31T23:30:00Z', '2025-01-01T00:00:00Z', '2025-01-01T00:30:00Z',
  ]);
  assert.deepEqual(positions.map((p) => p.isVisible), [false, true, true]);
  assert.equal(positions[0]!.azimuthDeg, 0);
  // Requested stop is included only if it falls on the regular sample grid.
  assert.equal(parseTimeline(earth, 'Earth', { ...query, end: '2026-11-14T02:30:00Z' }).length, 3);
  assert.equal(parseTimeline(single, 'Earth', { ...query, end: '2026-11-14T00:01:00Z' }).length, 1);
});

test('timeline rejects incomplete tables, missing or duplicate timestamps and unusable angles', () => {
  const replace = (before: string, after: string) => ({ result: earth.result.replace(before, after) });
  for (const payload of [
    null, [], {}, { error: 'No ephemeris' }, { result: 'no table' },
    replace('2026-Nov-14 01:00:00', '2026-Nov-14 00:00:00'),
    replace('2026-Nov-14 01:00:00', '2026-Nov-14 01:01:00'),
    replace('2026-Nov-14 01:00:00', '2026-Abc-14 01:00:00'),
    replace('2026-Nov-14 01:00:00', '2026-Nov-14 01:00:00.001'),
    replace('2026-Nov-14 01:00:00', '2026-Nov-14 24:00:00'),
    replace('Date__(UT)__HR:MN:SS', 'Date__(TT)__HR:MN:SS'),
    replace('MEAN_ME (high precision)', 'IAU_MOON'),
    replace('MEAN_ME (high precision)', 'MOON_ME, IAU_MOON'),
    replace('Center pole/equ', 'Missing pole/equ'),
    replace('1737.4, 1737.4, 1737.4', '1737.4, 1737.4, 1736.0'),
    replace('Center body name: Moon (301)', 'Center body name: Earth (399)'),
    replace('299.177599', 'n.a.'), replace('61.348525', '91'),
    replace('299.177599', ''), replace('Azi_(a-app)', 'unknown'),
    { result: earth.result.replace(/.*2026-Nov-14 01:00:00.*\n/, '') },
    { result: earth.result.replace('$$EOE', '2026-Nov-14 03:00:00, ,i, 290, 60,\n$$EOE') },
  ]) {
    assert.throws(() => parseTimeline(payload, 'Earth', query), /Horizons/, JSON.stringify(payload));
  }
});

test('mixed single-sample and timeline requests share one sequential queue', async () => {
  let active = 0;
  let maximum = 0;
  const commands: string[] = [];
  const client = createHorizonsClient(async (input) => {
    const request = new URL(String(input));
    commands.push(request.searchParams.get('COMMAND')!);
    active++;
    maximum = Math.max(maximum, active);
    await setTimeout(5);
    active--;
    return Response.json(request.searchParams.has('START_TIME') ? earth : single);
  });
  await Promise.all([
    client.timeline(query),
    client({ date: '2026-11-14', longitude: 23.5, latitude: -10 }),
    client.timeline(query),
  ]);
  assert.equal(maximum, 1);
  assert.deepEqual(commands, ["'399'", "'10'", "'399'", "'10'", "'399'", "'10'"]);
});

test('failed timelines return JSON errors without partial CSV and the queue recovers', async () => {
  let calls = 0;
  const client = createHorizonsClient(async () => {
    calls++;
    // Earth succeeds, but the first Sun table is shifted by a minute.
    return Response.json(calls === 2
      ? { result: sun.result.replace('2026-Nov-14 01:00:00', '2026-Nov-14 01:01:00') }
      : earth);
  });
  const app = buildApp({ getTimeline: client.timeline });
  const failed = await app.request(`${url}&format=csv`);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json() as ApiError).error.code, 'HORIZONS_ERROR');
  assert.equal(failed.headers.get('content-disposition'), null);
  const recovered = await app.request(url);
  assert.equal(recovered.status, 200);
  assert.equal(calls, 4);
});

test('timeline HTTP, JSON, network and timeout failures use the existing API errors', async () => {
  for (const fetcher of [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('invalid JSON'),
    async () => { throw new TypeError('network failed'); },
  ]) {
    const response = await buildApp({ getTimeline: createHorizonsClient(fetcher).timeline }).request(url);
    assert.equal(response.status, 502);
    assert.equal((await response.json() as ApiError).error.code, 'HORIZONS_ERROR');
  }
  const client = createHorizonsClient(async (_input, init) => {
    await setTimeout(20);
    init?.signal?.throwIfAborted();
    return Response.json(earth);
  }, 5);
  const response = await buildApp({ getTimeline: client.timeline }).request(url);
  assert.equal(response.status, 504);
  assert.equal((await response.json() as ApiError).error.code, 'HORIZONS_TIMEOUT');
});
