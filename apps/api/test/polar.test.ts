import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'csv-parse/browser/esm/sync';
import type { MoonQuery, MoonResponse, TimelineResponse } from '@lunar-lense/contracts';
import { buildApp } from '../src/app.js';
import { TerrainError } from '../src/terrain/errors.js';
import { destination } from '../src/terrain/geometry.js';
import { loadTerrain, validateManifest } from '../src/terrain/loader.js';
import { projectPolar } from '../src/terrain/polar.js';
import { calculateSkyline } from '../src/terrain/profile.js';
import { polarAssets } from './fixtures/polar-assets.js';
import { globalAssets } from './fixtures/global-assets.js';

const radius = 1737400;
const query: MoonQuery = { latitude: 90, longitude: 0, eyeHeightM: 2, azimuthStepDeg: 10, maxDistanceM: 3000 };

test('polar projection follows PDS cardinal orientation and inverse pixel equations in both hemispheres', () => {
  // Independent inverse from the PDS DSMAP_POLAR.CAT: I/J are one-based,
  // Y=(J-N/2-0.5)*scale*sign(latitude), longitude=atan2(X,Y).
  for (const pole of ['north', 'south'] as const) {
    const sign = pole === 'north' ? 1 : -1;
    assert.deepEqual(projectPolar(sign * 90, 0, pole, radius), { x: 0, y: sign === 1 ? -0 : 0 });
    const rho = 2 * radius * Math.tan(5 * Math.PI / 180);
    const zero = projectPolar(sign * 80, 0, pole, radius);
    assert.ok(Math.abs(zero.x) < 1e-9 && Math.abs(zero.y + sign * rho) < 1e-8);
    const east = projectPolar(sign * 80, 90, pole, radius);
    assert.ok(Math.abs(east.x - rho) < 1e-8 && Math.abs(east.y) < 1e-8);
    for (const [column, row] of [[0, 0], [3800, 3799], [4201, 6050], [7599, 7599]]) {
      const X = (column! + 1 - 7600 / 2 - 0.5) * 80;
      const Y = (row! + 1 - 7600 / 2 - 0.5) * 80 * sign;
      const latitude = sign * (90 - 2 * Math.atan(Math.hypot(X, Y) / (2 * radius)) * 180 / Math.PI);
      const longitude = Math.atan2(X, Y) * 180 / Math.PI;
      const projected = projectPolar(latitude, longitude, pole, radius);
      assert.ok(Math.abs((projected.x + 304000) / 80 - 0.5 - column!) < 1e-8);
      assert.ok(Math.abs((304000 - projected.y) / 80 - 0.5 - row!) < 1e-8);
    }
  }
});

test('polar loader decodes half-metre heights and interpolates across tile seams and longitude wrap', async () => {
  for (const pole of ['north', 'south'] as const) {
    const sign = pole === 'north' ? 1 : -1;
    // Affine map-plane heights have an exact bilinear interpolant; integer
    // samples land on the source's half-metre grid.
    const assets = polarAssets(pole, (x, y) => 100.5 + x / 80 + y / 40);
    const terrain = await loadTerrain({ ...query, latitude: sign * 90 }, assets.fetcher);
    assert.equal(terrain.sample(sign * 90, 0), 100.5);
    for (const longitude of [0, 45, 90, 179.9, 270, 359.9, -0.1]) {
      const latitude = sign * 89.95;
      const { x, y } = projectPolar(latitude, longitude, pole, radius);
      assert.ok(Math.abs(terrain.sample(latitude, longitude) - (100.5 + x / 80 + y / 40)) < 1e-8);
    }
    assert.ok(terrain.resolutionM > 79 && terrain.resolutionM <= 80);
    assert.equal(terrain.loadedBytes, terrain.loadedTileCount * 16 * 16 * 2);
    assert.equal(assets.requested.length, new Set(assets.requested).size);
  }
});

test('projected search bounds include every bearing even when crossing the pole', async () => {
  for (const pole of ['north', 'south'] as const) {
    const sign = pole === 'north' ? 1 : -1;
    const q = { ...query, latitude: sign * 89.96, longitude: 179.9 };
    const assets = polarAssets(pole);
    const terrain = await loadTerrain(q, assets.fetcher);
    for (let azimuth = 0; azimuth < 360; azimuth += 0.5) {
      const point = destination(q.latitude, q.longitude, azimuth, q.maxDistanceM, radius);
      assert.equal(terrain.sample(point.latitude, point.longitude), 100.5);
    }
    const profile = calculateSkyline(q, terrain);
    const expected = -Math.acos((radius + 100.5) / (radius + 102.5)) * 180 / Math.PI;
    assert.ok(profile.horizon.every(row => Math.abs(row.elevationDeg - expected) < 0.000003));
    assert.equal(assets.requested.length, new Set(assets.requested).size);
  }
});

test('polar errors reject wrong hemisphere, unprepared areas, missing data, and corrupt geometry', async () => {
  const assets = polarAssets('north');
  await assert.rejects(loadTerrain({ ...query, latitude: 80.05 }, assets.fetcher), /latitude coverage/);
  await assert.rejects(loadTerrain({ ...query, latitude: 90, maxDistanceM: 6000 }, assets.fetcher), /pixels/);
  await assert.rejects(loadTerrain(query, polarAssets('south').fetcher), /not prepared/);
  const wrongPole = polarAssets('south');
  await assert.rejects(loadTerrain(query, async path => path.endsWith('manifest.json')
    ? Response.json(wrongPole.manifest) : wrongPole.fetcher(path)), /selected polar region/);
  const nodata = await loadTerrain(query, polarAssets('north', () => NaN).fetcher);
  assert.throws(() => nodata.sample(90, 0), /missing/);
  const corrupt = polarAssets('north');
  for (const bytes of corrupt.files.values()) bytes[0] = bytes[0]! ^ 1;
  await assert.rejects(loadTerrain(query, corrupt.fetcher), /integrity/);
  const { manifest } = assets;
  for (const changes of [
    { encoding: 'float32-le' }, { heightScaleM: 1 }, { pole: 'east' },
    { originXM: 0 }, { width: 1e12 }, { pixelSizeM: 0 }, { centralLongitudeDeg: 90 },
    { referenceFrame: 'IAU_MOON' }, { referenceRadiusM: 1738000 },
    { noData: 0 }, { preparation: {} },
  ]) assert.throws(() => validateManifest({ ...manifest, ...changes }), TerrainError);
});

test('both polar Moon endpoints and timeline exports share height, skyline and visibility', async () => {
  for (const pole of ['north', 'south'] as const) {
    const latitude = pole === 'north' ? 90 : -90;
    const assets = globalAssets(undefined, undefined, 100.5);
    let upstreamCalls = 0;
    const app = buildApp({ fetchTerrainAsset: assets.fetcher, getTimeline: async input => {
      upstreamCalls++;
      assert.equal(input.latitude, latitude);
      assert.equal(input.altitudeKm, 0.1025);
      const positions = [input.start, input.end].map(timestamp => ({
        timestamp, azimuthDeg: 359.9, elevationDeg: -0.01, isVisible: false,
      }));
      return { earth: positions, sun: positions };
    } });
    const coordinates = `longitude=0&latitude=${latitude}&maxDistanceM=3000&azimuthStepDeg=10`;
    const moon = await app.request(`/api/moon?${coordinates}`);
    assert.equal(moon.status, 200);
    const profile = await moon.json() as MoonResponse;
    assert.equal(profile.moon.terrain.format, 'lunar-dem-lod-v1');
    const timelineUrl = `/api/timeline?${coordinates}&start=2026-11-14T00:00:00Z&end=2026-11-14T01:00:00Z`;
    const timeline = await app.request(timelineUrl);
    assert.equal(timeline.status, 200);
    const body = await timeline.json() as TimelineResponse;
    assert.deepEqual(body.moon, profile.moon);
    assert.deepEqual(body.observer, profile.observer);
    assert.ok(body.positions.earth.every(position => position.isVisible));
    assert.ok(body.positions.sun.every(position => position.isVisible));
    const moonCsv = await app.request(`/api/moon?${coordinates}&format=csv`);
    const moonRows = parse(await moonCsv.text(), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    assert.equal(moonRows[0]!.pixelsPerDegree, '');
    assert.equal(moonRows[0]!.pixelSizeM, '');
    assert.equal(moonRows[0]!.nearPixelsPerDegree, '64');
    assert.equal(moonRows[0]!.projection, 'simple-cylindrical');
    const csv = await app.request(`${timelineUrl}&format=csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition')!, /attachment/);
    const rows = parse(await csv.text(), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    assert.ok(rows.every(row => row.earthIsVisible === 'true' && row.sunIsVisible === 'true'));
    assert.equal(upstreamCalls, 2);
  }
});
