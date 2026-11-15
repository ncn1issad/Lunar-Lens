import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { CylindricalTerrainManifest, GeographicImageryLayer } from '@lunar-lense/contracts'
import {
  concurrent, imageryPatch, localSurfacePoint, previewSite, previewTimestamp, sampleTerrain, skyDirection, surfaceGrid,
} from '../src/surface-geometry.ts'
import type { SurfaceSnapshot } from '../src/surface-geometry.ts'

const manifest: CylindricalTerrainManifest = JSON.parse(await readFile(new URL('../public/terrain/manifest.json', import.meta.url), 'utf8'))
const snapshot: SurfaceSnapshot = JSON.parse(await readFile(new URL('../public/moon/surface-preview.json', import.meta.url), 'utf8'))
const layer = { maxZoom: 8, levelZeroColumns: 2, levelZeroRows: 1 } as GeographicImageryLayer

function close(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

test('sky directions use north, east and up in the same convention as Horizons', () => {
  for (const [az, el, expected] of [
    [0, 0, [0, 0, -1]], [90, 0, [1, 0, 0]], [180, 0, [0, 0, 1]],
    [270, 0, [-1, 0, 0]], [0, 90, [0, 1, 0]],
  ] as const) skyDirection(az, el).forEach((value, index) => close(value, expected[index]!))
  const direction = skyDirection(snapshot.positions.earth.azimuthDeg, snapshot.positions.earth.elevationDeg)
  close(Math.hypot(...direction), 1)
  close(Math.asin(direction[1]) * 180 / Math.PI, snapshot.positions.earth.elevationDeg)
});

test('local terrain preserves heights and lunar curvature without exaggeration', () => {
  const ground = snapshot.groundElevationM
  const radius = manifest.referenceRadiusM
  const center = localSurfacePoint(14, 303, ground, ground, radius)
  center.forEach(value => close(value, 0))
  close(localSurfacePoint(14, 303, ground + 100, ground, radius)[1], 100)
  const step = 0.1 * Math.PI / 180
  const north = localSurfacePoint(14.1, 303, ground, ground, radius)
  close(north[1], (radius + ground) * (Math.cos(step) - 1))
  close(north[2], -(radius + ground) * Math.sin(step))
  assert.ok(localSurfacePoint(14, 303.1, ground, ground, radius)[0] > 0)
  assert.ok(north[1] < 0)
});

test('imagery uses the 2:1 geographic matrix and covers the supported regional terrain', () => {
  const patch = imageryPatch(layer)
  assert.deepEqual([patch.minX, patch.maxX, patch.minY, patch.maxY], [173, 176, 106, 109])
  assert.ok(patch.westDeg > manifest.westDeg && patch.eastDeg < manifest.eastDeg)
  assert.ok(patch.southDeg > manifest.southDeg && patch.northDeg < manifest.northDeg)
  close(patch.eastDeg - patch.westDeg, 4 * 360 / 512)
  close(patch.northDeg - patch.southDeg, 4 * 180 / 256)
});

test('terrain interpolation crosses four tile boundaries and fails on missing data', () => {
  const m = { ...manifest, tileSize: 2, pixelsPerDegree: 2, westDeg: 302, northDeg: 15 }
  const tiles = new Map<string, DataView>()
  for (const [key, value] of [['0-0.bin', 0], ['1-0.bin', 10], ['0-1.bin', 20], ['1-1.bin', 30]] as const) {
    const buffer = new ArrayBuffer(16)
    const view = new DataView(buffer)
    for (let offset = 0; offset < 16; offset += 4) view.setFloat32(offset, value, true)
    tiles.set(key, view)
  }
  close(sampleTerrain(m, tiles, 14, 303), 15)
  tiles.delete('1-1.bin')
  assert.throws(() => sampleTerrain(m, tiles, 14, 303), /unavailable/)
});

test('mesh UVs align with the imagery atlas and triangles face upward', () => {
  const patch = imageryPatch(layer)
  const grid = surfaceGrid(patch, manifest.referenceRadiusM, () => 0, 16)
  assert.equal(grid.positions.length, 17 * 17 * 3)
  assert.equal(grid.indices.length, 16 * 16 * 6)
  assert.deepEqual([...grid.uvs.slice(0, 2)], [0, 1])
  assert.deepEqual([...grid.uvs.slice(-2)], [1, 0])
  const middle = (8 * 17 + 8) * 3
  for (const value of grid.positions.slice(middle, middle + 3)) close(value, 0)
  for (let i = 0; i < grid.indices.length; i += 3) {
    const a = grid.indices[i]! * 3, b = grid.indices[i + 1]! * 3, c = grid.indices[i + 2]! * 3
    const abX = grid.positions[b]! - grid.positions[a]!, abZ = grid.positions[b + 2]! - grid.positions[a + 2]!
    const acX = grid.positions[c]! - grid.positions[a]!, acZ = grid.positions[c + 2]! - grid.positions[a + 2]!
    assert.ok(abZ * acX - abX * acZ > 0)
  }
});

test('captured ephemerides match the prepared observer height and fixed preview time', async () => {
  const tiles = new Map<string, DataView>()
  for (const key of ['1-1.bin', '2-1.bin', '1-2.bin', '2-2.bin']) {
    const buffer = await readFile(new URL(`../public/terrain/${key}`, import.meta.url))
    tiles.set(key, new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength))
  }
  assert.equal(snapshot.timestamp, previewTimestamp)
  assert.equal(snapshot.latitudeDeg, previewSite.latitudeDeg)
  assert.equal(snapshot.longitudeDeg, previewSite.longitudeDeg)
  assert.equal(snapshot.eyeHeightM, previewSite.eyeHeightM)
  close(sampleTerrain(manifest, tiles, previewSite.latitudeDeg, previewSite.longitudeDeg), snapshot.groundElevationM)
  assert.ok(snapshot.positions.sun.elevationDeg > 0)
  assert.ok(snapshot.positions.earth.distanceKm > 350000 && snapshot.positions.earth.distanceKm < 410000)
});

test('imagery and terrain downloads have a bounded number of concurrent requests', async () => {
  let active = 0, maximum = 0, completed = 0
  await concurrent(Array.from({ length: 16 }, (_, i) => i), async () => {
    maximum = Math.max(maximum, ++active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    completed++
  })
  assert.equal(completed, 16)
  assert.equal(maximum, 4)
});
