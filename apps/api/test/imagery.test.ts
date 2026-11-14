import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ApiError, GeographicImageryLayer } from '@lunar-lense/contracts';
import { buildApp } from '../src/app.js';

const jpeg = await readFile(new URL('./fixtures/wac-global-z0-x0-y0.jpg', import.meta.url));
const tileUrl = '/api/imagery/tiles/wac-global/0/0/0';
const upstreamBase = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm';
const imageResponse = () => new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });

test('layer metadata describes the geographic grid without fetching upstream', async () => {
  const app = buildApp({ imagery: { fetcher: async () => { throw new Error('must not fetch'); } } });
  const response = await app.request('/api/imagery/layers/wac-global');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json() as GeographicImageryLayer, {
    id: 'wac-global',
    source: 'Moon Trek',
    sourceLayer: 'LRO_WAC_Mosaic_Global_303ppd_v02',
    projection: 'equirectangular',
    nativeCrs: 'urn:ogc:def:crs:EPSG::104903',
    longitudeConvention: 'east-positive',
    boundsDeg: { west: -180, south: -90, east: 180, north: 90 },
    tileSize: 256,
    minZoom: 0,
    maxZoom: 8,
    matrixSet: 'default028mm',
    scheme: 'xyz',
    levelZeroColumns: 2,
    levelZeroRows: 1,
    contentType: 'image/jpeg',
    tileUrlTemplate: '/api/imagery/tiles/wac-global/{z}/{x}/{y}',
    appearance: 'photographic',
    credit: 'NASA / LRO / LROC; served by Moon Trek',
  });
});

test('tiles preserve JPEG bytes and map XYZ to the upstream row/column order', async () => {
  const requests: string[] = [];
  const app = buildApp({ imagery: { fetcher: async (input, init) => {
    requests.push(String(input));
    assert.equal(new Headers(init?.headers).get('accept'), 'image/jpeg');
    assert.equal(init?.redirect, 'manual');
    assert.ok(init?.signal);
    // Unrelated upstream headers must not leak through the proxy.
    return new Response(jpeg, { headers: {
      'Content-Type': 'image/jpeg; charset=binary',
      'Set-Cookie': 'upstream=value',
      'Content-Disposition': 'attachment',
    } });
  } } });
  for (const [z, x, y] of [[0, 0, 0], [0, 1, 0], [1, 3, 1], [8, 511, 255]]) {
    const response = await app.request(`/api/imagery/tiles/wac-global/${z}/${x}/${y}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
    assert.equal(requests.at(-1), `${upstreamBase}/${z}/${y}/${x}.jpg`);
  }
  assert.equal(requests.length, 4);
});

test('malformed and out-of-matrix coordinates never reach Moon Trek', async () => {
  let calls = 0;
  const app = buildApp({ imagery: { fetcher: async () => { calls++; return imageResponse(); } } });
  for (const coordinates of [
    '-1/0/0', '9/0/0', '1.5/0/0', '1e0/0/0', '0x1/0/0', 'NaN/0/0', 'Infinity/0/0',
    '%20/0/0', '0/-1/0', '0/0/-1', '0/0.5/0', '0/0/0.5', '0/2/0', '0/0/1',
    '1/4/0', '1/0/2', '8/512/0', '8/0/256', '0/9007199254740993/0',
    '0/%2B1/0', '0/%200/0', '0/0/1e0',
  ]) {
    const response = await app.request(`/api/imagery/tiles/wac-global/${coordinates}`);
    assert.equal(response.status, 400, coordinates);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal((await response.json() as ApiError).error.code, 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
});

test('only registered layer IDs resolve, including on the metadata route', async () => {
  let calls = 0;
  const app = buildApp({ imagery: { fetcher: async () => { calls++; return imageResponse(); } } });
  for (const id of ['unknown', 'constructor', '__proto__', 'https%3A%2F%2Fexample.com']) {
    for (const path of [`/layers/${id}`, `/tiles/${id}/0/0/0`]) {
      const response = await app.request(`/api/imagery${path}`);
      assert.equal(response.status, 404, path);
      assert.equal((await response.json() as ApiError).error.code, 'NOT_FOUND');
    }
  }
  assert.equal(calls, 0);
});

test('caller query parameters cannot change the fixed upstream URL', async () => {
  const requests: string[] = [];
  const app = buildApp({ imagery: { fetcher: async input => {
    requests.push(String(input));
    return imageResponse();
  } } });
  for (const query of ['', '?date=2026-11-15', '?url=https://example.com&x=100']) {
    const response = await app.request(`${tileUrl}${query}`);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.deepEqual(requests, Array(3).fill(`${upstreamBase}/0/0/0.jpg`));
});

test('upstream HTTP errors are JSON, and rejected response bodies are cancelled', async () => {
  for (const [status, expectedStatus, code] of [
    [404, 404, 'NOT_FOUND'], [403, 502, 'IMAGERY_ERROR'], [429, 502, 'IMAGERY_ERROR'],
    [500, 502, 'IMAGERY_ERROR'], [503, 502, 'IMAGERY_ERROR'], [302, 502, 'IMAGERY_ERROR'],
    [206, 502, 'IMAGERY_ERROR'],
  ] as const) {
    let cancelled = false;
    const app = buildApp({ imagery: { fetcher: async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    }), { status, headers: { 'Content-Type': 'image/jpeg' } }) } });
    const response = await app.request(tileUrl);
    assert.equal(response.status, expectedStatus, String(status));
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal((await response.json() as ApiError).error.code, code);
    assert.equal(cancelled, true);
  }
});

test('network failures, non-images, empty images and failed body downloads return 502', async () => {
  const fetchers: typeof fetch[] = [
    async () => { throw new TypeError('private network details'); },
    async () => new Response('<html>upstream error</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => Response.json({ error: 'upstream error' }),
    async () => new Response(jpeg),
    async () => new Response(null, { headers: { 'Content-Type': 'image/jpeg' } }),
    async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('private body failure')); },
    }), { headers: { 'Content-Type': 'image/jpeg' } }),
  ];
  for (const fetcher of fetchers) {
    const response = await buildApp({ imagery: { fetcher } }).request(tileUrl);
    assert.equal(response.status, 502);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    const payload = await response.json() as ApiError;
    assert.equal(payload.error.code, 'IMAGERY_ERROR');
    assert.doesNotMatch(payload.error.message, /private/);
  }
});

test('timeout covers waiting for upstream headers and downloading the body', async () => {
  const fetchers: typeof fetch[] = [
    async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }),
    async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener('abort', () => controller.error(init!.signal!.reason), { once: true });
      },
    }), { headers: { 'Content-Type': 'image/jpeg' } }),
  ];
  for (const fetcher of fetchers) {
    const response = await buildApp({ imagery: { fetcher, timeoutMs: 5 } }).request(tileUrl);
    assert.equal(response.status, 504);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.equal((await response.json() as ApiError).error.code, 'IMAGERY_TIMEOUT');
  }
});

test('cancelling the caller aborts the upstream imagery request', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let upstreamSignal: AbortSignal | null | undefined;
  const app = buildApp({ imagery: { fetcher: async (_input, init) => {
    upstreamSignal = init?.signal;
    return new Promise((_resolve, reject) => {
      upstreamSignal!.addEventListener('abort', () => reject(upstreamSignal!.reason), { once: true });
      started();
    });
  } } });
  const pending = app.request(tileUrl, { signal: controller.signal });
  await ready;
  controller.abort();
  const response = await pending;
  assert.equal(upstreamSignal?.aborted, true);
  assert.equal(response.status, 502);
  assert.equal((await response.json() as ApiError).error.code, 'IMAGERY_ERROR');
});

test('an upstream failure does not prevent a later successful tile request', async () => {
  let calls = 0;
  const app = buildApp({ imagery: { fetcher: async () => {
    if (++calls === 1) throw new TypeError('temporary failure');
    return imageResponse();
  } } });
  assert.equal((await app.request(tileUrl)).status, 502);
  const response = await app.request(tileUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.equal(calls, 2);
});
