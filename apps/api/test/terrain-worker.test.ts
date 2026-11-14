import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFetchMock, Miniflare } from 'miniflare';
import type { MoonResponse, TimelineResponse } from '@lunar-lense/contracts';
import { parse } from 'csv-parse/browser/esm/sync';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

test('bundled Worker calculates global LDEM_64/LDEM_16 skylines through ASSETS', { timeout: 120000 }, async t => {
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  const reference = await fixture('global-reference');
  const ephemerides = {
    north: { earth: await fixture('global-north-earth'), sun: await fixture('global-north-sun') },
    south: { earth: await fixture('global-south-earth'), sun: await fixture('global-south-sun') },
  };
  const upstreamSites: string[] = [];
  fetchMock.get('https://ssd.jpl.nasa.gov')
    .intercept({ path: /^\/api\/horizons\.api\?/, method: 'GET' })
    .reply(request => {
      const params = new URL(request.path, 'https://ssd.jpl.nasa.gov').searchParams;
      const site = params.get('SITE_COORD')!;
      upstreamSites.push(site);
      const pole = site.includes(',-90,') ? 'south' : 'north';
      const body = params.get('COMMAND') === "'399'" ? 'earth' : 'sun';
      return { statusCode: 200, data: JSON.stringify(ephemerides[pole][body]) };
    }).persist();
  const runtime = new Miniflare({
    modules: true, scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    compatibilityDate: config.compatibility_date, fetchMock,
    assets: {
      binding: config.assets.binding,
      directory: fileURLToPath(new URL(config.assets.directory, new URL('../', import.meta.url))),
      routerConfig: { has_user_worker: true, static_routing: { user_worker: config.assets.run_worker_first } },
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
  });
  t.after(() => runtime.dispose());
  await (await runtime.dispatchFetch('http://localhost/api/health')).arrayBuffer();
  const moon = async (latitude: number, longitude: number, extra = '') => {
    const started = performance.now();
    const response = await runtime.dispatchFetch(`http://localhost/api/moon?longitude=${longitude}&latitude=${latitude}${extra}`);
    assert.equal(response.status, 200, await response.clone().text());
    const profile = await response.json() as MoonResponse;
    if (!extra) t.diagnostic(`${latitude},${longitude}: ${(performance.now() - started).toFixed(1)} ms local wall time, ${profile.moon.calculation.loadedBytes} tile bytes, ${profile.moon.calculation.samplesPerAzimuth * profile.moon.horizon.length} ray samples, ${profile.moon.calculation.farCellCount} far cells. Not production CPU time.`);
    return profile;
  };
  for (const ppd of [64, 16]) {
    for (const sample of reference.levels[ppd].pixels) {
      const col = Math.floor(sample.column / 256), row = Math.floor(sample.row / 256);
      const tile = await readFile(new URL(`../../web/public/terrain/ldem_${ppd}/${col}-${row}.bin`, import.meta.url));
      assert.equal(tile.readInt16LE(((sample.row % 256) * 256 + sample.column % 256) * 2), sample.dn);
      if (ppd === 64) {
        const profile = await moon(sample.latitudeDeg, sample.longitudeDeg, '&maxDistanceM=100&azimuthStepDeg=10');
        assert.equal(profile.observer.groundElevationM, sample.elevationM);
      }
    }
  }
  for (const [lat, lon] of [[14, 303], [0, 0], [0, 359.99], [88.02, 123], [-88.02, 270]]) {
    const profile = await moon(lat!, lon!);
    assert.equal(profile.moon.horizon.length, 2880);
    assert.equal(profile.moon.terrain.format, 'lunar-dem-lod-v1');
    assert.equal(profile.moon.calculation.maxDistanceM, 480000);
    assert.equal(profile.moon.calculation.farFieldCoverage, 'cell-envelope');
    assert.ok(profile.moon.calculation.loadedBytes < 48 * 1024 * 1024);
    assert.ok(profile.moon.horizon.every(row => Number.isFinite(row.elevationDeg) && row.distanceM <= 480000));
    assert.equal(profile.observer.altitudeKm, (profile.observer.groundElevationM + 2) / 1000);
  }
  for (const pole of ['north', 'south'] as const) {
    const latitude = pole === 'north' ? 90 : -90;
    const profile = await moon(latitude, 0);
    assert.equal(profile.observer.groundElevationM, reference.levels[64].poles[pole].groundElevationM);
    const rotated = await moon(latitude, 123, '&maxDistanceM=100&azimuthStepDeg=10');
    assert.equal(rotated.observer.groundElevationM, profile.observer.groundElevationM);
    const url = `http://localhost/api/timeline?longitude=0&latitude=${latitude}&start=2026-11-15T00:00:00Z&end=2026-11-15T01:00:00Z`;
    const response = await runtime.dispatchFetch(url);
    assert.equal(response.status, 200, await response.clone().text());
    const timeline = await response.json() as TimelineResponse;
    assert.deepEqual(timeline.moon, profile.moon);
    assert.deepEqual(timeline.observer, profile.observer);
    for (const name of ['earth', 'sun'] as const) {
      assert.equal(timeline.positions[name].length, 2);
      for (const row of timeline.positions[name]) assert.equal(row.isVisible, row.elevationDeg >= row.terrainHorizonElevationDeg);
    }
    const download = await runtime.dispatchFetch(`${url}&format=csv`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition')!, /attachment/);
    const rows = parse(await download.text(), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    rows.forEach((row, index) => {
      assert.equal(row.earthIsVisible, String(timeline.positions.earth[index]!.isVisible));
      assert.equal(row.sunIsVisible, String(timeline.positions.sun[index]!.isVisible));
      assert.equal(Number(row.altitudeKm), profile.observer.altitudeKm);
    });
    assert.deepEqual(upstreamSites.splice(0), Array(4).fill(`'0,${latitude},${profile.observer.altitudeKm}'`));
  }
});
