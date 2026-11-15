import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { Window } from 'happy-dom'
import type { GlobalTerrainManifest, GeographicImageryLayer, TimelineResponse } from '@lunar-lense/contracts'
import { savedSurfaceSnapshot, startSurfaceSnapshot, SURFACE_PLAN_STORAGE_KEY } from '../src/surface-plan.ts'
import { imageryPatch, localSurfacePoint, surfaceGrid } from '../src/surface-geometry.ts'
import { globalTerrainKeys, globalTerrainSampler } from '../src/surface-terrain.ts'

const window = new Window()
Object.defineProperty(globalThis, 'sessionStorage', { value: window.sessionStorage, configurable: true })
after(async () => window.happyDOM.close())

function timeline() {
  return {
    range: { start: '2026-11-15T12:30:00Z', end: '2026-11-16T12:30:00Z', stepMinutes: 60, sampleCount: 2 },
    observer: { body: 'moon', latitudeDeg: 0.67416, longitudeDeg: 23.47314,
      groundElevationM: -2000, eyeHeightM: 3, altitudeKm: -1.997 },
    positions: {
      earth: [{ timestamp: '2026-11-15T12:30:00Z', azimuthDeg: 120, elevationDeg: 25, isVisible: true, terrainHorizonElevationDeg: 1 },
        { timestamp: '2026-11-15T13:30:00Z', azimuthDeg: 130, elevationDeg: 30, isVisible: true, terrainHorizonElevationDeg: 1 }],
      sun: [{ timestamp: '2026-11-15T12:30:00Z', azimuthDeg: 240, elevationDeg: -10, isVisible: false, terrainHorizonElevationDeg: 2 },
        { timestamp: '2026-11-15T13:30:00Z', azimuthDeg: 250, elevationDeg: -5, isVisible: false, terrainHorizonElevationDeg: 2 }],
    }, source: 'NASA/JPL Horizons', timeScale: 'UTC',
  } as TimelineResponse
}

test('the planned scene uses the response observer and the first sample at the start time', () => {
  const response = timeline()
  const snapshot = startSurfaceSnapshot(response)
  assert.equal(snapshot.timestamp, response.range.start)
  assert.equal(snapshot.latitudeDeg, response.observer.latitudeDeg)
  assert.equal(snapshot.longitudeDeg, response.observer.longitudeDeg)
  assert.equal(snapshot.groundElevationM, -2000)
  assert.equal(snapshot.eyeHeightM, 3)
  assert.equal(snapshot.positions.earth.azimuthDeg, 120)
  assert.equal(snapshot.positions.sun.elevationDeg, -10)
  assert.ok(snapshot.positions.earth.distanceKm > 350000)
  assert.ok(snapshot.positions.sun.distanceKm > 140000000)
  response.observer.longitudeDeg = -57
  assert.equal(startSurfaceSnapshot(response).longitudeDeg, 303)
})

test('missing, invalid or mismatched start samples cannot create a scene', () => {
  const response = timeline()
  response.positions.sun[0]!.timestamp = response.positions.sun[1]!.timestamp
  assert.throws(() => startSurfaceSnapshot(response), /starting surface conditions/)
  response.positions.sun = []
  assert.throws(() => startSurfaceSnapshot(response), /starting surface conditions/)
  const invalid = timeline()
  invalid.observer.groundElevationM = NaN
  assert.throws(() => startSurfaceSnapshot(invalid), /starting surface conditions/)
})

test('refresh restores submitted conditions and corrupt storage never becomes a fixed preview', () => {
  sessionStorage.clear()
  assert.equal(savedSurfaceSnapshot(), null)
  const snapshot = startSurfaceSnapshot(timeline())
  sessionStorage.setItem(SURFACE_PLAN_STORAGE_KEY, JSON.stringify(snapshot))
  assert.deepEqual(savedSurfaceSnapshot(), snapshot)
  for (const value of ['invalid json', '{}', JSON.stringify({ ...snapshot, latitudeDeg: 91 })]) {
    sessionStorage.setItem(SURFACE_PLAN_STORAGE_KEY, value)
    assert.equal(savedSurfaceSnapshot(), null)
  }
})

const layer = { minZoom: 0, maxZoom: 8, levelZeroColumns: 2, levelZeroRows: 1 } as GeographicImageryLayer

test('terrain and imagery recenter on the submitted site, including seams and poles', () => {
  for (const [latitudeDeg, longitudeDeg] of [[0.67416, 23.47314], [0, 0], [0, 180], [90, 0], [-90, 303]]) {
    const site = { latitudeDeg: latitudeDeg!, longitudeDeg: longitudeDeg!, eyeHeightM: 2 }
    const patch = imageryPatch(layer, site)
    assert.ok(patch.northDeg >= site.latitudeDeg && patch.southDeg <= site.latitudeDeg)
    assert.ok(patch.westDeg <= site.longitudeDeg && patch.eastDeg >= site.longitudeDeg)
    assert.ok((patch.maxX - patch.minX + 1) * (patch.maxY - patch.minY + 1) <= 64)
    assert.ok(patch.minY >= 0 && patch.maxY < 2 ** patch.z)
    const center = localSurfacePoint(site.latitudeDeg, site.longitudeDeg, -2000, -2000, 1737400, site)
    center.forEach(value => assert.ok(Math.abs(value) < 1e-8))
    const grid = surfaceGrid(patch, 1737400, () => -2000, 16, site)
    assert.ok(grid.positions.every(Number.isFinite))
    assert.ok(grid.uvs.every(value => value >= 0 && value <= 1))
  }
})

const manifest = { pixelsPerDegree: 1, width: 360, height: 180, tileSize: 2,
  noData: -32768, heightScaleM: 0.5 } as GlobalTerrainManifest

function tilesFor(keys: string[]) {
  return new Map(keys.map(key => {
    const [col, row] = key.replace('.bin', '').split('-').map(Number)
    const buffer = new ArrayBuffer(8), view = new DataView(buffer)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      view.setInt16((y * 2 + x) * 2, col! * 2 + x + (row! * 2 + y) * 2, true)
    }
    return [key, view] as const
  }))
}

test('global terrain interpolates across the longitude seam and fails on missing tiles', () => {
  const patch = { westDeg: 359.8, eastDeg: 360.2, northDeg: 0.2, southDeg: -0.2 } as ReturnType<typeof imageryPatch>
  const keys = globalTerrainKeys(manifest, patch)
  assert.deepEqual(new Set(keys), new Set(['179-44.bin', '0-44.bin', '179-45.bin', '0-45.bin']))
  const tiles = tilesFor(keys), sample = globalTerrainSampler(manifest, tiles)
  assert.equal(sample(0, 0), (179.5 + 89.5 * 2) * 0.5)
  assert.equal(sample(0, 360), sample(0, 0))
  tiles.delete('0-44.bin')
  assert.throws(() => sample(0, 0), /unavailable/)
})

test('global terrain converges to one pole height at every longitude', () => {
  for (const latitudeDeg of [-90, 90]) {
    const patch = imageryPatch(layer, { latitudeDeg, longitudeDeg: 0, eyeHeightM: 2 })
    const sample = globalTerrainSampler(manifest, tilesFor(globalTerrainKeys(manifest, patch)))
    for (const longitude of [0, 23, 180, 303, 359]) {
      assert.ok(Math.abs(sample(latitudeDeg, longitude) - sample(latitudeDeg, 0)) < 1e-8)
    }
  }
})
