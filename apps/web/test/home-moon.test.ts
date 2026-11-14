import assert from 'node:assert/strict'
import test from 'node:test'
import { Body, Illumination, Libration, NextMoonQuarter, SearchMoonQuarter } from 'astronomy-engine'
import { Vector3 } from 'three'
import { getHomeMoonState } from '../src/home-moon.ts'

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
