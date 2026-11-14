import assert from 'node:assert/strict';
import test from 'node:test';
import type { MoonQuery } from '@lunar-lense/contracts';
import { loadGlobalTerrain } from '../src/terrain/global.js';
import { calculateSkyline, interpolateSkyline } from '../src/terrain/profile.js';
import { destination } from '../src/terrain/geometry.js';
import { globalAssets } from './fixtures/global-assets.js';

const query: MoonQuery = { latitude: 0, longitude: 0, eyeHeightM: 2, azimuthStepDeg: 10, maxDistanceM: 480000 };

test('global calculation loads only two int16 levels, includes the 60 km transition, and keeps nearby checks small', async () => {
  const assets = globalAssets();
  const terrain = await loadGlobalTerrain(query, assets.fetcher);
  assert.equal(terrain.manifest.format, 'lunar-dem-lod-v1');
  assert.equal(terrain.sample(0, 0), 100);
  assert.ok(terrain.loadedBytes < 4 * 1024 * 1024);
  assert.ok(assets.requested.every(path => /^\/terrain\/ldem_(16|64)\//.test(path)));
  assert.equal(assets.requested.length, new Set(assets.requested).size);
  const bands = terrain.samplingBands!;
  assert.equal(bands[0]!.endM, 60000);
  assert.equal(bands[1]!.startM, 60000);
  assert.equal(bands[1]!.endM, 480000);
  assert.equal(bands[1]!.stepM, bands[0]!.stepM * 4);
  const sampled: number[] = [];
  const profile = calculateSkyline(query, { ...terrain, sample: (lat, lon, d) => { sampled.push(d ?? 0); return terrain.sample(lat, lon, d); } });
  assert.ok(sampled.includes(60000));
  assert.ok(sampled.includes(480000));
  assert.ok(profile.samplesPerAzimuth * 2880 < 3_000_000);
  const nearby = globalAssets();
  const small = await loadGlobalTerrain({ ...query, maxDistanceM: 60000 }, nearby.fetcher);
  assert.equal(small.samplingBands!.length, 1);
  assert.ok(nearby.requested.every(path => path.startsWith('/terrain/ldem_64/')));
});

test('global coverage wraps longitude and crosses either pole without a regional fallback', async () => {
  for (const [latitude, longitude] of [[0, 359.99], [89, 123], [-89, 270], [90, 0], [-90, 360]]) {
    const assets = globalAssets();
    const q = { ...query, latitude: latitude!, longitude: longitude! };
    const terrain = await loadGlobalTerrain(q, assets.fetcher);
    for (let az = 0; az < 360; az += 5) {
      for (const distanceM of [1, 60000, 60001, 480000]) {
        const p = destination(q.latitude, q.longitude, az, distanceM, 1737400);
        assert.ok(Math.abs(terrain.sample(p.latitude, p.longitude, distanceM) - 100) < 1e-10);
      }
    }
    assert.equal(terrain.sample(latitude!, 0), terrain.sample(latitude!, 360));
    assert.ok(terrain.loadedBytes < 48 * 1024 * 1024);
    assert.equal(assets.requested.length, new Set(assets.requested).size);
  }
});

test('far-cell envelopes catch a tall peak between coarse test rays', async () => {
  // A real LDEM_16 pixel centre about 119 km away, between 0 and 10 degree rays.
  const assets = globalAssets((lat, lon, ppd) => ppd === 16 && lat === 3.90625 && lon === 0.46875 ? 10000 : 0,
    { north: 5, south: -1, west: 0, east: 2 }, 0);
  const terrain = await loadGlobalTerrain(query, assets.fetcher);
  const thinRays = calculateSkyline(query, { ...terrain, visitFarCells: undefined });
  const covered = calculateSkyline(query, terrain);
  assert.ok(thinRays.horizon.every(row => row.elevationDeg < 0));
  assert.ok(interpolateSkyline(covered.horizon, 6.8) > 1);
  assert.ok(covered.farCellCount > 0);
  assert.ok(covered.horizon.some(row => row.distanceM > 60000));
});

test('pole interpolation has one height and converges continuously from every longitude', async () => {
  const assets = globalAssets((_lat, lon) => 100 + 50 * Math.sin(lon * Math.PI / 180),
    { north: 90, south: 89, west: 0, east: 360 });
  const terrain = await loadGlobalTerrain({ ...query, latitude: 90, maxDistanceM: 100 }, assets.fetcher);
  for (const longitude of [0, 45, 90, 180, 270, 359.99]) {
    assert.equal(terrain.sample(90, longitude), 100);
    assert.ok(Math.abs(terrain.sample(89.999999, longitude) - 100) < 0.01);
  }
});

test('a mountain beyond 240 km can determine the skyline of an observer on high ground', async () => {
  const latitude = 0.0078125, longitude = 0.0078125;
  const assets = globalAssets((lat, lon, ppd) => {
    if (ppd === 64 && lat === latitude && lon === longitude) return 10000;
    if (ppd === 16 && lat === 10.03125 && lon === 0.03125) return 10000;
    return 0;
  }, { north: 11, south: -1, west: 0, east: 2 }, 0);
  const q = { ...query, latitude, longitude };
  const terrain = await loadGlobalTerrain(q, assets.fetcher);
  assert.equal(terrain.sample(latitude, longitude), 10000);
  const profile = calculateSkyline(q, terrain);
  const north = profile.horizon[0]!;
  assert.ok(north.distanceM > 240000 && north.distanceM < 480000);
  assert.ok(north.elevationDeg > -5.5);
});

test('global loader rejects damaged assets and incompatible source metadata', async () => {
  for (const change of [{ heightScaleM: 1 }, { referenceFrame: 'IAU_MOON' }, { width: 123 }, { pixelsPerDegree: 16 }, { sourceVersion: 'V2.0' }]) {
    const assets = globalAssets();
    Object.assign(assets.manifests[64]!, change);
    await assert.rejects(loadGlobalTerrain(query, assets.fetcher), /assets are unavailable or invalid/);
  }
  const corrupt = globalAssets();
  const key = '/terrain/ldem_64/0-22.bin';
  const bytes = corrupt.files.get(key)!.slice();
  bytes[0] = bytes[0]! ^ 1;
  corrupt.files.set(key, bytes);
  await assert.rejects(loadGlobalTerrain(query, corrupt.fetcher), /integrity/);
  const absent = globalAssets();
  absent.files.delete(key);
  await assert.rejects(loadGlobalTerrain(query, absent.fetcher), /Cannot load terrain tile/);
});
