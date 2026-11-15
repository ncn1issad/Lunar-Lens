import assert from 'node:assert/strict'
import test from 'node:test'
import { Body, Illumination, Libration, NextMoonQuarter, SearchMoonQuarter } from 'astronomy-engine'
import { Quaternion, Vector3 } from 'three'
import { animateMoonState, getHomeMoonState } from '../src/home-moon.ts'

test('lighting matches full, new, and both quarter phases without mirroring', () => {
  let quarter = SearchMoonQuarter(new Date('2026-11-01T00:00:00Z'))
  for (let i = 0; i < 4; i++) {
    const date = quarter.time.date
    const { sunDirection } = getHomeMoonState(date)
    const fraction = (1 + sunDirection.z) / 2
    assert.ok(Math.abs(fraction - Illumination(Body.Moon, date).phase_fraction) < 1e-10)
    assert.ok(Math.abs(sunDirection.length() - 1) < 1e-10)
    if (quarter.quarter === 0) assert.ok(fraction < 0.01, 'new Moon faces away from sunlight')
    if (quarter.quarter === 2) assert.ok(fraction > 0.99, 'full Moon faces sunlight')
    if (quarter.quarter === 1) assert.ok(sunDirection.x > 0, 'waxing Moon is lit on the right')
    if (quarter.quarter === 3) assert.ok(sunDirection.x < 0, 'waning Moon is lit on the left')
    quarter = NextMoonQuarter(quarter)
  }
})

test('texture orientation agrees with lunar libration throughout a month', () => {
  for (let day = 1; day <= 30; day++) {
    const date = new Date(Date.UTC(2026, 10, day))
    const { orientation } = getHomeMoonState(date)
    const localEarth = new Vector3(0, 0, 1).applyQuaternion(orientation.clone().invert())
    const longitude = Math.atan2(-localEarth.z, localEarth.x) * 180 / Math.PI
    const latitude = Math.asin(localEarth.y) * 180 / Math.PI
    const libration = Libration(date)
    // Independent libration formulas differ slightly from the IAU axis model.
    assert.ok(Math.abs(longitude - libration.elon) < 0.1, `longitude on day ${day}`)
    assert.ok(Math.abs(latitude - libration.elat) < 0.1, `latitude on day ${day}`)
    const north = new Vector3(0, 1, 0).applyQuaternion(orientation)
    assert.ok(Math.abs(north.x) < 1e-10 && north.y > 0, 'lunar north stays up')
    assert.ok(Math.abs(orientation.length() - 1) < 1e-10)
  }
})

test('timezone offsets representing the same instant produce the same view', () => {
  const utc = getHomeMoonState(new Date('2026-11-14T12:00:00Z'))
  const local = getHomeMoonState(new Date('2026-11-14T14:00:00+02:00'))
  assert.ok(utc.sunDirection.distanceTo(local.sunDirection) < 1e-10)
  assert.ok(utc.orientation.angleTo(local.orientation) < 1e-7)
})

test('advancing the clock changes lighting and orientation', () => {
  const first = getHomeMoonState(new Date('2026-11-14T12:00:00Z'))
  const next = getHomeMoonState(new Date('2026-11-15T12:00:00Z'))
  assert.ok(first.sunDirection.distanceTo(next.sunDirection) > 0.1)
  assert.ok(first.orientation.angleTo(next.orientation) > 0.001)
})

test('date previews animate toward a changing target and settle without further redraws', () => {
  const current = getHomeMoonState(new Date('2026-11-14T12:00:00Z'))
  const target = getHomeMoonState(new Date('2026-11-21T12:00:00Z'))
  const start = current.sunDirection.clone()
  assert.equal(animateMoonState(current, target, 16), true)
  assert.ok(current.sunDirection.distanceTo(start) > 0)
  assert.ok(current.sunDirection.distanceTo(target.sunDirection) > 0.1)
  const originalAngle = start.angleTo(target.sunDirection)
  for (let frame = 0; frame < 17; frame++) animateMoonState(current, target, 16)
  assert.ok(current.sunDirection.angleTo(target.sunDirection) > originalAngle * 0.2, 'the transition is still visible after about 300 ms')
  // A second hover interrupts the transition and proceeds from the displayed state.
  const next = getHomeMoonState(new Date('2026-12-01T12:00:00Z'))
  for (let frame = 0; frame < 240; frame++) animateMoonState(current, next, 16)
  assert.ok(current.orientation.equals(next.orientation))
  assert.ok(current.sunDirection.equals(next.sunDirection))
  assert.equal(animateMoonState(current, next, 16), false)
})

test('opposite light directions animate around the Moon with a unit-length direction', () => {
  const current = { orientation: new Quaternion(), sunDirection: new Vector3(0, 0, 1) }
  const target = { orientation: new Quaternion(), sunDirection: new Vector3(0, 0, -1) }
  for (let frame = 0; frame < 240; frame++) {
    animateMoonState(current, target, 16)
    assert.ok(Math.abs(current.sunDirection.length() - 1) < 1e-10)
  }
  assert.ok(current.sunDirection.equals(target.sunDirection))
})
