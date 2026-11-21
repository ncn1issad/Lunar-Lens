import assert from 'node:assert/strict'
import test from 'node:test'
import { PerspectiveCamera, Vector3 } from 'three'
import { surfaceIndicatorPosition } from '../src/surface-indicators.ts'
import { skyDirection } from '../src/surface-geometry.ts'

test('on-screen callouts match the perspective camera, including near the frame edge', () => {
  const camera = new PerspectiveCamera(58, 2, 0.1, 5000)
  for (const direction of [[0, 0, -1], [0.7, 0.2, -1], [1.09, 0, -1]]) {
    const projected = new Vector3(...direction).project(camera)
    const marker = surfaceIndicatorPosition(direction, 1000, 500, 58)
    assert.equal(marker.offscreen, false)
    assert.ok(Math.abs(marker.x - (projected.x + 1) * 500) < 1e-8)
    assert.ok(Math.abs(marker.y - (1 - projected.y) * 250) < 1e-8)
  }
})

test('off-screen bodies stick to all four edges and corners', () => {
  for (const [direction, x, y] of [
    [[2, 0, -1], 976, 250], [[-2, 0, -1], 24, 250],
    [[0, 2, -1], 500, 24], [[0, -2, -1], 500, 476],
    [[2, 2, -1], 726, 24],
  ] as const) {
    const marker = surfaceIndicatorPosition(direction, 1000, 500, 58)
    assert.equal(marker.offscreen, true)
    assert.ok(Math.abs(marker.x - x) < 1e-8)
    assert.ok(Math.abs(marker.y - y) < 1e-8)
  }
})

test('rearward targets keep the correct turn direction instead of mirroring across the camera', () => {
  for (const back of [0, 0.01, 1, 10]) {
    assert.equal(surfaceIndicatorPosition([0.1, 0, back], 1000, 500, 58).x, 976)
    assert.equal(surfaceIndicatorPosition([-0.1, 0, back], 1000, 500, 58).x, 24)
    assert.equal(surfaceIndicatorPosition([0, 0.1, back], 1000, 500, 58).y, 24)
  }
  const behind = surfaceIndicatorPosition([0, 0, 1], 1000, 500, 58)
  assert.equal(behind.offscreen, true)
  assert.equal(behind.x, 976)
  assert.equal(behind.y, 250)
})

test('camera rotation brings an edge marker back onto its body', () => {
  const camera = new PerspectiveCamera(58, 2, 0.1, 5000)
  const direction = new Vector3(...skyDirection(120, 25))
  assert.equal(surfaceIndicatorPosition(direction.toArray(), 1000, 500, 58).offscreen, true)
  camera.lookAt(direction)
  direction.applyQuaternion(camera.quaternion.clone().invert())
  const centered = surfaceIndicatorPosition(direction.toArray(), 1000, 500, 58)
  assert.equal(centered.offscreen, false)
  assert.ok(Math.abs(centered.x - 500) < 1e-8)
  assert.ok(Math.abs(centered.y - 250) < 1e-8)
})

test('edge positions stay finite and inside narrow portrait viewports', () => {
  for (const width of [80, 320, 1600]) {
    for (const direction of [[1, -2, 1], [-1, 2, -1], [0, 0, 1]]) {
      const marker = surfaceIndicatorPosition(direction, width, 600, 58)
      assert.ok(Number.isFinite(marker.angle))
      assert.ok(marker.x >= 0 && marker.x <= width)
      assert.ok(marker.y >= 0 && marker.y <= 600)
    }
  }
})
