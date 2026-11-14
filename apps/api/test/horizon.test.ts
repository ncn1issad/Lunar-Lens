import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { ApiError, HorizonResponse } from '@lunar-lense/contracts';
import { buildApp } from '../src/app.js';
import { createHorizonsClient, parsePosition } from '../src/horizons.js';

const fixture = async (name: string) => JSON.parse(
  await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
);
const earth = await fixture('earth');
const sun = await fixture('sun');
const expected = await fixture('expected');
const query = { date: '2026-11-14', longitude: 23.5, latitude: -10 };
const url = '/api/horizon?date=2026-11-14&longitude=23.5&latitude=-10';

function table(azimuth: string, elevation: string) {
  return { result: `Date, , , Elev_(a-app), Azi_(a-app),\n$$SOE\n2026-Nov-14 00:00:00, , , ${elevation}, ${azimuth},\n$$EOE` };
}

test('endpoint matches Python results using captured NASA responses', async () => {
  const requests: URL[] = [];
  const client = createHorizonsClient(async (input) => {
    const upstream = new URL(String(input));
    requests.push(upstream);
    return Response.json(upstream.searchParams.get('COMMAND') === "'399'" ? earth : sun);
  });
  const app = buildApp({ getPositions: client });
  const response = await app.request(url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    date: query.date,
    time: '00:00:00',
    timeScale: 'UTC',
    observer: { body: 'moon', longitudeDeg: 23.5, latitudeDeg: -10, altitudeKm: 0 },
    positions: expected,
    source: 'NASA/JPL Horizons',
  });
  assert.deepEqual(requests.map((request) => request.searchParams.get('COMMAND')), ["'399'", "'10'"]);
  const params = requests[0]!.searchParams;
  assert.equal(params.get('CENTER'), "'coord@301'");
  assert.equal(params.get('SITE_COORD'), "'23.5,-10,0'");
  assert.equal(params.get('TLIST'), "'2026-11-14 00:00:00'");
  assert.equal(params.get('ELEV_CUT'), "'-90'");
});

test('visibility includes the horizon and the parser uses column labels', () => {
  assert.deepEqual(parsePosition(table('360', '0'), 'Earth'), {
    azimuthDeg: 0, elevationDeg: 0, isVisible: true,
  });
  assert.equal(parsePosition(table('10', '-0.00001'), 'Sun').isVisible, false);
  assert.equal(parsePosition(table('10', '90'), 'Sun').isVisible, true);
});

test('rejects malformed upstream data rather than producing misleading positions', () => {
  for (const payload of [
    null, [], {}, { error: 'invalid date' }, { result: 'missing table' },
    table('NaN', '0'), table('361', '0'), table('0', '-91'), table('', '0'),
    table('0', 'Infinity'), { result: '$$SOE\n1,2,3\n$$EOE' },
    { result: table('0', '0').result.replace('$$EOE', '2026-Nov-15, , , 1, 2,\n$$EOE') },
  ]) {
    assert.throws(() => parsePosition(payload, 'Earth'), /Horizons/);
  }
});

test('invalid inputs never reach Horizons', async () => {
  let upstreamCalls = 0;
  const app = buildApp({ getPositions: async () => { upstreamCalls++; return expected; } });
  const invalidQueries = [
    '', 'date=2026-11-14',
    'date=2026-02-30&longitude=0&latitude=0',
    'date=2025-02-29&longitude=0&latitude=0',
    'date=0000-01-01&longitude=0&latitude=0',
    'date=2026-1-01&longitude=0&latitude=0',
    'date=2026-11-14&longitude=361&latitude=0',
    'date=2026-11-14&longitude=-181&latitude=0',
    'date=2026-11-14&longitude=0&latitude=91',
    'date=2026-11-14&longitude=NaN&latitude=0',
    'date=2026-11-14&longitude=Infinity&latitude=0',
    'date=2026-11-14&longitude=&latitude=0',
    'date=2026-11-14&longitude=0&latitude=0&extra=1',
    'date=2026-11-14&longitude=0&longitude=1&latitude=0',
    'date=2026-11-14&date=2026-11-15&longitude=0&latitude=0',
    'date=2026-11-14&longitude=0&latitude=0&latitude=1',
    'date=2026-11-14&longitude=0&latitude=%20',
    'date=2026-11-14&longitude=0x10&latitude=0',
  ];
  for (const querystring of invalidQueries) {
    const response = await app.request(`/api/horizon?${querystring}`);
    assert.equal(response.status, 400, querystring);
    assert.equal((await response.json() as ApiError).error.code, 'INVALID_INPUT');
  }
  assert.equal(upstreamCalls, 0);
});

test('accepts coordinate boundaries and preserves historical time scales', async () => {
  const app = buildApp({ getPositions: async () => expected });
  for (const [date, longitude, latitude, timeScale] of [
    ['1961-01-01', -180, -90, 'UT1'],
    ['1962-01-01', 360, 90, 'UTC'],
    ['2024-02-29', 0, 0, 'UTC'],
  ]) {
    const response = await app.request(`/api/horizon?date=${date}&longitude=${longitude}&latitude=${latitude}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as HorizonResponse).timeScale, timeScale);
  }
});

test('upstream HTTP, JSON, parsing and network failures return 502', async () => {
  const fetchers: typeof fetch[] = [
    async () => new Response('unavailable', { status: 503 }),
    async () => new Response('invalid JSON'),
    async () => Response.json({ error: 'invalid ephemeris' }),
    async () => { throw new TypeError('fetch failed'); },
  ];
  for (const fetcher of fetchers) {
    const app = buildApp({ getPositions: createHorizonsClient(fetcher) });
    const response = await app.request(url);
    assert.equal(response.status, 502);
    assert.equal((await response.json() as ApiError).error.code, 'HORIZONS_ERROR');
  }
});

test('upstream timeout returns 504', async () => {
  const app = buildApp({ getPositions: createHorizonsClient(async (_input, init) => {
    await setTimeout(20);
    init?.signal?.throwIfAborted();
    return Response.json(earth);
  }, 5) });
  const response = await app.request(url);
  assert.equal(response.status, 504);
  assert.equal((await response.json() as ApiError).error.code, 'HORIZONS_TIMEOUT');
});

test('serializes upstream calls and recovers after a failed request', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const client = createHorizonsClient(async () => {
    active++;
    maximum = Math.max(maximum, active);
    const call = ++calls;
    await setTimeout(5);
    active--;
    if (call === 1) throw new Error('temporary failure');
    return Response.json(earth);
  });
  const results = await Promise.allSettled([client(query), client(query), client(query)]);
  assert.deepEqual(results.map((result) => result.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.equal(maximum, 1);
  assert.equal(calls, 5);
});

test('health and unknown API routes never reach Horizons', async () => {
  const app = buildApp({ getPositions: async () => { throw new Error('should not be called'); } });
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const missing = await app.request('/api/unknown', { headers: { 'Sec-Fetch-Mode': 'navigate' } });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json() as ApiError).error.code, 'NOT_FOUND');
});

test('unexpected failures return a generic 500 without exposing internal details', async (t) => {
  t.mock.method(console, 'error', () => {});
  const app = buildApp({ getPositions: async () => { throw new Error('private implementation detail'); } });
  const response = await app.request(url);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' },
  });
});
