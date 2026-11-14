import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parse } from 'csv-parse/browser/esm/sync';
import type { MoonQuery, MoonResponse, TerrainHorizonSample, TerrainManifest } from '@lunar-lense/contracts';
import { TerrainError } from '../src/terrain/errors.js';
import { apparentElevationDeg, destination } from '../src/terrain/geometry.js';
import { loadTerrain, validateManifest, type AssetFetcher, type TerrainSurface } from '../src/terrain/loader.js';
import { calculateSkyline, interpolateSkyline, terrainVisibility } from '../src/terrain/profile.js';
import { createMoonRoutes, parseMoonQuery } from '../src/terrain/routes.js';
import { globalAssets } from './fixtures/global-assets.js';

const radius = 1737400;
const query: MoonQuery = { longitude: 2, latitude: 2, eyeHeightM: 2, azimuthStepDeg: 90, maxDistanceM: 1000 };
const sphere: TerrainSurface = { referenceRadiusM: radius, resolutionM: 10, sample: () => 0 };

function assets(height: (lat: number, lon: number) => number = () => 100) {
  const files = new Map<string, Uint8Array>();
  const manifest: TerrainManifest = {
    format: 'lunar-dem-f32-v1', id: 'test', source: 'synthetic', sourceUrl: 'https://example.com/source.img',
    sourceProduct: 'test', sourceVersion: 'test', referenceFrame: 'MOON_ME_DE421', referenceRadiusM: radius,
    projection: 'simple-cylindrical', registration: 'pixel-center', heightUnit: 'meter',
    encoding: 'float32-le', noData: 'NaN', pixelsPerDegree: 4, tileSize: 4,
    northDeg: 4, southDeg: 0, westDeg: 0, eastDeg: 4,
    tiles: {}, preparation: { sourceLabelSha256: '0'.repeat(64), sourceRangesSha256: [] },
  };
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      view.setFloat32((y * 4 + x) * 4, height(4 - (row * 4 + y + 0.5) / 4, (col * 4 + x + 0.5) / 4), true);
    }
    const name = `${col}-${row}.bin`;
    manifest.tiles[name] = createHash('sha256').update(bytes).digest('hex');
    files.set(`/terrain/${name}`, bytes);
  }
  const requested: string[] = [];
  const fetcher: AssetFetcher = async path => {
    requested.push(path);
    if (path === '/terrain/manifest.json') return Response.json(manifest);
    const data = files.get(path);
    return data ? new Response(Uint8Array.from(data)) : new Response(null, { status: 404 });
  };
  return { manifest, files, fetcher, requested };
}

test('spherical skyline agrees with the analytic horizon dip at multiple eye heights', () => {
  for (const [ground, eye] of [[0, 2], [-3000, 10], [2000, 100]]) {
    const profile = calculateSkyline({ ...query, eyeHeightM: eye!, maxDistanceM: 30000 }, { ...sphere, sample: () => ground! });
    const expected = -Math.acos((radius + ground!) / (radius + ground! + eye!)) * 180 / Math.PI;
    assert.equal(profile.firstDistanceM, 1);
    for (const sample of profile.horizon) {
      assert.ok(sample.elevationDeg < 0);
      assert.ok(Math.abs(sample.elevationDeg - expected) < 0.000001, `${sample.elevationDeg} versus ${expected}`);
    }
  }
});

test('nearby ridge within the old 200 m exclusion determines the skyline', () => {
  const terrain = {
    ...sphere,
    sample: (lat: number) => Math.max(0, 20 * (1 - Math.abs(lat * Math.PI / 180 * radius - 50) / 10)),
  };
  const profile = calculateSkyline({ ...query, longitude: 0, latitude: 0 }, terrain);
  const north = profile.horizon[0]!;
  assert.equal(north.distanceM, 50);
  assert.ok(north.elevationDeg > 19);
  assert.ok(profile.horizon[2]!.elevationDeg < 0);
});

test('far terrain is sampled at the same radial resolution and can set the skyline', () => {
  const terrain = {
    ...sphere, resolutionM: 20,
    sample: (lat: number) => Math.max(0, 2000 * (1 - Math.abs(lat * Math.PI / 180 * radius - 25000) / 20)),
  };
  const north = calculateSkyline({ ...query, longitude: 0, latitude: 0, maxDistanceM: 30000 }, terrain).horizon[0]!;
  assert.equal(north.distanceM, 25000);
  assert.ok(north.elevationDeg > 4);
});

test('interpolation crosses north, normalizes azimuth and keeps below-zero visibility', () => {
  const horizon: TerrainHorizonSample[] = [
    { azimuthDeg: 0, elevationDeg: -2, distanceM: 1 },
    { azimuthDeg: 90, elevationDeg: 2, distanceM: 1 },
    { azimuthDeg: 180, elevationDeg: 4, distanceM: 1 },
    { azimuthDeg: 270, elevationDeg: 6, distanceM: 1 },
  ];
  assert.equal(interpolateSkyline(horizon, 315), 2);
  assert.equal(interpolateSkyline(horizon, -45), 2);
  assert.equal(interpolateSkyline(horizon, 360), -2);
  assert.deepEqual(terrainVisibility(horizon, { azimuthDeg: 0, elevationDeg: -1 }), {
    terrainHorizonElevationDeg: -2, isVisible: true,
  });
  assert.equal(terrainVisibility(horizon, { azimuthDeg: 45, elevationDeg: 0 }).isVisible, true);
  assert.equal(terrainVisibility(horizon, { azimuthDeg: 90, elevationDeg: 1 }).isVisible, false);
});

test('destination crosses the antimeridian and remains defined at both poles', () => {
  const east = destination(0, 359.999, 90, 1000, radius);
  assert.ok(east.longitude < 1);
  assert.ok(Math.abs(east.latitude) < 1e-10);
  for (const lat of [-90, 90]) for (const az of [0, 90, 180, 270]) {
    const p = destination(lat, 42, az, 1000, radius);
    assert.ok(Math.abs(Math.abs(p.latitude) - (90 - 1000 / radius * 180 / Math.PI)) < 1e-9);
    assert.ok(Number.isFinite(p.longitude));
  }
  const p = destination(14, 303, 123, 100, radius);
  assert.ok(p.latitude < 14 && p.longitude > 303);
  assert.ok(Math.abs(apparentElevationDeg(1, 0, 0, radius) + 0.5 / radius * 180 / Math.PI) < 1e-12);
});

test('loader interpolates pixel centres across tile seams and reuses the loaded tiles', async () => {
  const fixture = assets((lat, lon) => lat * 10 + lon * 100);
  const terrain = await loadTerrain(query, fixture.fetcher);
  assert.equal(terrain.sample(2, 2), 220);
  assert.ok(Math.abs(terrain.sample(2.01, 2.02) - 222.1) < 1e-9);
  assert.equal(terrain.loadedTileCount, 4);
  assert.equal(terrain.loadedBytes, 256);
  assert.equal(fixture.requested.length, 5);
  assert.equal(new Set(fixture.requested).size, 5);
  calculateSkyline(query, terrain);
  assert.equal(fixture.requested.length, 5);
  // A new calculation loads inputs again, without a persistent cache.
  await loadTerrain(query, fixture.fetcher);
  assert.equal(fixture.requested.length, 10);
});

test('cylindrical loader rejects unsupported locations before loading tiles', async () => {
  for (const q of [
    { ...query, longitude: 0.001 }, { ...query, longitude: 2, maxDistanceM: 120000 },
  ]) {
    const fixture = assets();
    await assert.rejects(loadTerrain(q, fixture.fetcher), (e: unknown) => e instanceof TerrainError && e.code === 'TERRAIN_OUT_OF_COVERAGE');
    assert.deepEqual(fixture.requested, ['/terrain/manifest.json']);
  }
});

test('loader reports missing tiles, corruption, malformed metadata and no-data explicitly', async () => {
  const missing = assets();
  missing.files.clear();
  await assert.rejects(loadTerrain(query, missing.fetcher), /Cannot load terrain tile/);
  const corrupt = assets();
  for (const data of corrupt.files.values()) data[0] = data[0]! ^ 1;
  await assert.rejects(loadTerrain(query, corrupt.fetcher), /integrity check/);
  const truncated = assets();
  for (const name of truncated.files.keys()) truncated.files.set(name, new Uint8Array(4));
  await assert.rejects(loadTerrain(query, truncated.fetcher), /invalid size/);
  const nodata = assets(() => NaN);
  const terrain = await loadTerrain(query, nodata.fetcher);
  assert.throws(() => terrain.sample(2, 2), /missing or invalid/);
  assert.throws(() => calculateSkyline(query, { ...sphere, sample: lat => lat === 2 ? 0 : NaN }), /missing/);
  for (const invalid of [null, {}, { ...assets().manifest, heightUnit: 'kilometer' }, { ...assets().manifest, pixelsPerDegree: 1e9 }]) {
    assert.throws(() => validateManifest(invalid), TerrainError);
  }
  await assert.rejects(loadTerrain(query, async () => new Response('<html>SPA fallback</html>')), /manifest/);
});

test('terrain query bounds reject duplicates, unknown keys and unbounded calculations', () => {
  assert.deepEqual(parseMoonQuery(new URLSearchParams('longitude=-57&latitude=14')), {
    longitude: -57, latitude: 14, eyeHeightM: 2, azimuthStepDeg: 0.125, maxDistanceM: 480000,
  });
  for (const suffix of [
    '&extra=1', '&longitude=2', '&latitude=2', '&eyeHeightM=2&eyeHeightM=3',
    '&eyeHeightM=0', '&eyeHeightM=10.001', '&azimuthStepDeg=0.1', '&azimuthStepDeg=7',
    '&maxDistanceM=480001', '&maxDistanceM=99', '&eyeHeightM=NaN', '&eyeHeightM=0x10',
    '&eyeHeightM=', '&azimuthStepDeg=Infinity', '&format=xml', '&format=json&format=csv',
  ]) assert.throws(() => parseMoonQuery(new URLSearchParams(`longitude=2&latitude=2${suffix}`)), Error, suffix);
  for (const params of ['', 'longitude=2', 'longitude=2&latitude=91', 'longitude=361&latitude=2']) {
    assert.throws(() => parseMoonQuery(new URLSearchParams(params)));
  }
  assert.throws(() => calculateSkyline({ ...query, maxDistanceM: 120000, azimuthStepDeg: 0.25 }, { ...sphere, resolutionM: 1 }), /three million/);
});

test('moon CSV downloads the same calculated rows and observer metadata as JSON', async () => {
  const fixture = globalAssets();
  fixture.manifests[64]!.source = 'source, "quoted"';
  const app = createMoonRoutes(fixture.fetcher);
  const path = '/?longitude=2&latitude=2&azimuthStepDeg=10&maxDistanceM=1000';
  const body = await (await app.request(path)).json() as MoonResponse;
  const response = await app.request(path + '&format=csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/csv/);
  assert.match(response.headers.get('content-disposition')!, /attachment/);
  const rows = parse(await response.text(), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  assert.equal(rows.length, body.moon.horizon.length);
  rows.forEach((row, i) => {
    assert.equal(Number(row.azimuthDeg), body.moon.horizon[i]!.azimuthDeg);
    assert.equal(Number(row.terrainHorizonElevationDeg), body.moon.horizon[i]!.elevationDeg);
    assert.equal(Number(row.peakDistanceM), body.moon.horizon[i]!.distanceM);
    assert.equal(Number(row.altitudeKm), body.observer.altitudeKm);
    assert.equal(Number(row.maxDistanceM), body.moon.calculation.maxDistanceM);
    assert.equal(row.referenceFrame, body.moon.terrain.referenceFrame);
    assert.equal(row.sourceProduct, 'LDEM_64');
  });
});

test('moon endpoint exposes one profile, ground altitude and resolution metadata', async () => {
  const fixture = globalAssets();
  const response = await createMoonRoutes(fixture.fetcher).request('/?longitude=2&latitude=2&azimuthStepDeg=90&maxDistanceM=1000&eyeHeightM=10');
  // Public requests limit azimuthStepDeg to 10; coarse rays above are for geometry tests.
  assert.equal(response.status, 400);
  const valid = await createMoonRoutes(fixture.fetcher).request('/?longitude=2&latitude=2&azimuthStepDeg=10&maxDistanceM=1000&eyeHeightM=10');
  assert.equal(valid.status, 200);
  const body = await valid.json() as MoonResponse;
  assert.deepEqual(body.observer, { body: 'moon', longitudeDeg: 2, latitudeDeg: 2, groundElevationM: 100, eyeHeightM: 10, altitudeKm: 0.11 });
  assert.equal(body.moon.horizon.length, 36);
  assert.ok(body.moon.horizon.every(row => row.elevationDeg < 0));
  assert.equal(body.moon.terrain.referenceRadiusM, radius);
  assert.equal(body.moon.calculation.searchLimit, 'fixed-distance');
  assert.equal(body.moon.calculation.loadedTileCount, 2);
  assert.equal(body.moon.calculation.firstDistanceM, 1);
  const outside = await createMoonRoutes(fixture.fetcher).request('/?longitude=2&latitude=90');
  assert.equal(outside.status, 200); // Global calculation data covers both poles.
  const unavailable = await createMoonRoutes(async () => new Response(null, { status: 404 })).request('/?longitude=2&latitude=2');
  assert.equal(unavailable.status, 503);
});
