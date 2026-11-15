import assert from 'node:assert/strict'
import test from 'node:test'
import { OrthographicCamera, Vector3 } from 'three'
import { frameMoonInViewport } from '../src/moon-viewport.ts'

test('the full canvas preserves the globe position and size in its layout slot', () => {
  for (const viewport of [
    { width: 1440, height: 900, frame: { x: 780, y: 150, width: 560, height: 585 } },
    { width: 390, height: 844, frame: { x: 24, y: 430, width: 342, height: 265 } },
  ]) {
    const { width, height, frame } = viewport
    const camera = new OrthographicCamera()
    camera.position.z = 4.3
    camera.updateMatrixWorld()
    for (const zoom of [0.5, 1, 2, 20]) {
      camera.zoom = zoom
      frameMoonInViewport(camera, width, height, frame)
      const center = new Vector3().project(camera)
      assert.ok(Math.abs((center.x + 1) * width / 2 - (frame.x + frame.width / 2)) < 1e-8)
      assert.ok(Math.abs((1 - center.y) * height / 2 - (frame.y + frame.height / 2)) < 1e-8)
      const left = new Vector3(-1, 0, 0).project(camera)
      const right = new Vector3(1, 0, 0).project(camera)
      const diameter = (right.x - left.x) * width / 2
      assert.ok(Math.abs(diameter - Math.min(frame.width, frame.height) * zoom) < 1e-8)
    }
  }
})

test('zoomed surface can extend left of the former column and remain inside the canvas', () => {
  const camera = new OrthographicCamera()
  camera.position.z = 4.3
  camera.updateMatrixWorld()
  camera.zoom = 2
  const frame = { x: 780, y: 150, width: 560, height: 585 }
  frameMoonInViewport(camera, 1440, 900, frame)
  const edge = new Vector3(-1, 0, 0).project(camera)
  const screenX = (edge.x + 1) * 1440 / 2
  assert.ok(screenX < frame.x)
  assert.ok(screenX > 0)
})

test('location mode pins the rendered Moon to the viewport centre regardless of its layout slot', () => {
  const camera = new OrthographicCamera()
  camera.position.set(2, 1, 4)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  for (const x of [0, 300, 800]) {
    frameMoonInViewport(camera, 1440, 900, { x, y: -45, width: 990, height: 990 }, true)
    const center = new Vector3().project(camera)
    assert.ok(Math.abs(center.x) < 1e-10)
    assert.ok(Math.abs(center.y) < 1e-10)
  }
})
