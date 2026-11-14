import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFetchMock, Miniflare } from 'miniflare';
import type { MoonResponse } from '@lunar-lense/contracts';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('bundled Worker loads prepared SLDEM tiles through ASSETS and calculates the skyline', { timeout: 30000 }, async t => {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const runtime = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    compatibilityDate: config.compatibility_date,
    fetchMock,
    assets: {
      binding: config.assets.binding,
      directory: fileURLToPath(new URL(config.assets.directory, new URL('../', import.meta.url))),
      routerConfig: { has_user_worker: true, static_routing: { user_worker: config.assets.run_worker_first } },
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
  });
  t.after(() => runtime.dispose());
  // Prime runtime startup before measuring local end-to-end latency.
  await (await runtime.dispatchFetch('http://localhost/api/health')).arrayBuffer();
  const started = performance.now();
  const response = await runtime.dispatchFetch('http://localhost/api/moon?longitude=303&latitude=14');
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as MoonResponse;
  const elapsed = performance.now() - started;
  assert.equal(body.moon.horizon.length, 720);
  assert.equal(body.moon.terrain.id, 'sldem2015-v2-marius-hills-512ppd');
  assert.equal(body.moon.terrain.pixelsPerDegree, 512);
  assert.equal(body.moon.calculation.loadedTileCount, 8);
  assert.equal(body.moon.calculation.loadedBytes, 8 * 1024 * 1024);
  assert.ok(body.observer.groundElevationM > -6000 && body.observer.groundElevationM < 4000);
  assert.equal(body.observer.altitudeKm, (body.observer.groundElevationM + 2) / 1000);
  assert.ok(body.moon.horizon.every(row => Number.isFinite(row.elevationDeg) && row.distanceM <= 30000));
  assert.ok(body.moon.horizon.some(row => row.elevationDeg > 0));
  t.diagnostic(`Local workerd request ${elapsed.toFixed(1)} ms; ${body.moon.calculation.samplesPerAzimuth * 720} samples; ${body.moon.calculation.loadedBytes} loaded terrain bytes. This is wall time, not production CPU time.`);

  const outside = await runtime.dispatchFetch('http://localhost/api/moon?longitude=0&latitude=0');
  assert.equal(outside.status, 422);
  assert.equal((await outside.json() as { error: { code: string } }).error.code, 'TERRAIN_OUT_OF_COVERAGE');
  const polar = await runtime.dispatchFetch('http://localhost/api/moon?longitude=0&latitude=-90');
  assert.equal(polar.status, 422);
});
