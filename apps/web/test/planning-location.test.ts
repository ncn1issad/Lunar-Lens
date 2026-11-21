import assert from 'node:assert/strict'
import test from 'node:test'
import { Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three'
import { locationFromPoint, locationNormal, normalizeLongitude, resolveLocation } from '../src/planning-location.ts'
import type { TimelineResponse } from '@lunar-lense/contracts'
import { matchesRecentPlan, rememberPlan } from '../src/recent-plans.ts'
import { frameMoonInViewport } from '../src/moon-viewport.ts'
import { getHomeMoonState } from '../src/home-moon.ts'

test('coordinates accept global API coverage and normalize equivalent longitudes', () => {
  assert.deepEqual(resolveLocation({ latitude: '14', longitude: '303' }).location, { latitude: 14, longitude: -57 })
  for (const latitude of ['-90', '90']) assert.ok(resolveLocation({ latitude, longitude: '360' }).location)
  for (const draft of [{ latitude: '', longitude: '0' }, { latitude: '91', longitude: '0' },
    { latitude: '0', longitude: '361' }, { latitude: 'NaN', longitude: '0' }]) assert.equal(resolveLocation(draft).location, null)
  assert.equal(normalizeLongitude(180), -180)
  assert.equal(normalizeLongitude(360), 0)
})

test('history distinguishes dates at the same site and moves equivalent repeated scenarios to the top', () => {
  const response = (latitudeDeg: number, longitudeDeg: number, day = '15') => ({
    observer: { latitudeDeg, longitudeDeg },
    range: { start: `2026-11-${day}T09:30:00Z`, end: `2026-11-${day}T10:45:00Z` },
    positions: {
      earth: ['09:30', '10:30'].map(time => ({ timestamp: `2026-11-${day}T${time}:00Z`, isVisible: true })),
      sun: ['09:30', '10:30'].map(time => ({ timestamp: `2026-11-${day}T${time}:00Z`, isVisible: false })),
    },
  }) as TimelineResponse
  let recent = rememberPlan([], response(14, 303))
  recent = rememberPlan(recent, response(14, -57, '16'))
  recent = rememberPlan(recent, response(14, -57))
  assert.equal(recent.length, 2)
  assert.equal(recent[0]!.location.longitude, -57)
  assert.equal(recent[0]!.range.startDate, '2026-11-15')
  assert.equal(recent[1]!.range.startDate, '2026-11-16')
  // Preserve the requested end, even when it falls after the final hourly sample.
  assert.equal(recent[0]!.range.endTime, '10:45')
  assert.equal(recent[0]!.visibility, 'linear-gradient(to right, #b4befe 0% 100%)')
  assert.equal(matchesRecentPlan(recent[0]!, { latitude: 14, longitude: 303 }, recent[0]!.range), true)
  assert.equal(matchesRecentPlan(recent[0]!, recent[0]!.location, recent[1]!.range), false)
  assert.equal(matchesRecentPlan(recent[0]!, recent[0]!.location, null), false)
  recent = rememberPlan(recent, response(0.67416, 23.47314))
  assert.equal(recent.length, 3, 'Submitted presets also belong in history')
  for (let latitude = 30; latitude < 45; latitude++) recent = rememberPlan(recent, response(latitude, 0))
  assert.equal(recent.length, 10)
  assert.equal(recent[0]!.location.latitude, 44)
  assert.equal(recent.at(-1)!.location.latitude, 35)
})

test('coordinates use the Moon texture axes and round-trip across both poles and the longitude seam', () => {
  assert.ok(locationNormal({ latitude: 0, longitude: 0 }).distanceTo(new Vector3(1, 0, 0)) < 1e-10)
  assert.ok(locationNormal({ latitude: 0, longitude: 90 }).distanceTo(new Vector3(0, 0, -1)) < 1e-10)
  for (const latitude of [-90, -89.9, 0, 45, 90]) {
    for (const longitude of [-180, -57, 0, 120, 179.9]) {
      const result = locationFromPoint(locationNormal({ latitude, longitude }))
      assert.ok(Math.abs(result.latitude - latitude) < 1e-8)
      assert.ok(Math.abs(normalizeLongitude(result.longitude - longitude)) < 1e-8)
    }
  }
})

test('click rays recover lunar coordinates after date rotation, camera rotation and full-viewport framing', () => {
  const mesh = new Mesh(new SphereGeometry(1, 128, 64), new MeshBasicMaterial())
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  frameMoonInViewport(camera, 1440, 900, { x: 360, y: -50, width: 1000, height: 1000 })
  const ray = new Raycaster()
  for (const orientation of [new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2),
    getHomeMoonState(new Date('2026-12-03T12:00:00Z')).orientation]) {
    mesh.quaternion.copy(orientation)
    mesh.updateMatrixWorld(true)
    for (const expected of [{ latitude: 14, longitude: -57 }, { latitude: -80, longitude: 135 }, { latitude: 0, longitude: -179 }]) {
      const worldPoint = mesh.localToWorld(locationNormal(expected))
      camera.position.copy(worldPoint).multiplyScalar(4.3)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)
      const screen = worldPoint.clone().project(camera)
      ray.setFromCamera(new Vector2(screen.x, screen.y), camera)
      const hit = ray.intersectObject(mesh, false)[0]
      assert.ok(hit)
      const actual = locationFromPoint(mesh.worldToLocal(hit.point.clone()))
      assert.ok(Math.abs(actual.latitude - expected.latitude) < 1e-8)
      assert.ok(Math.abs(normalizeLongitude(actual.longitude - expected.longitude)) < 1e-8)
    }
  }
  ray.setFromCamera(new Vector2(-1, 1), camera)
  assert.equal(ray.intersectObject(mesh, false).length, 0)
  mesh.geometry.dispose()
  mesh.material.dispose()
})
