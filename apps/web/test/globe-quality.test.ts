import assert from 'node:assert/strict'
import test from 'node:test'
import { createGlobeQualityController, globeTextureSize } from '../src/globe-quality.ts'

test('texture quality respects GPU limits and smaller devices', () => {
  assert.equal(globeTextureSize(16384, false, 8), 8192)
  assert.equal(globeTextureSize(16384, true, 8), 4096)
  assert.equal(globeTextureSize(16384, false, 4), 4096)
  assert.equal(globeTextureSize(4096, false), 4096)
  assert.equal(globeTextureSize(2048, false), 2048)
})

test('base quality stays lightweight until preload or Planner requests the detail', async () => {
  let loads = 0
  const applied: (string | null)[] = []
  const released: string[] = []
  const controller = createGlobeQualityController(async () => { loads++; return '8k maps' }, value => applied.push(value), value => released.push(value))
  controller.setEnabled(false)
  assert.equal(loads, 0)
  controller.setEnabled(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(applied.at(-1), '8k maps')
  controller.setEnabled(false)
  assert.equal(applied.at(-1), null)
  controller.setEnabled(true)
  assert.equal(applied.at(-1), '8k maps')
  assert.equal(loads, 1)
  controller.dispose()
  assert.deepEqual(released, ['8k maps'])
})

test('page load preloads the detail without applying it, and Planner reuses the prepared resource', async () => {
  let loads = 0
  const applied: (string | null)[] = []
  const released: string[] = []
  const controller = createGlobeQualityController(async () => { loads++; return 'prepared maps' }, value => applied.push(value), value => released.push(value))
  controller.preload()
  controller.preload()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(loads, 1)
  assert.deepEqual(applied, [])
  controller.setEnabled(true)
  assert.deepEqual(applied, ['prepared maps'])
  controller.setEnabled(false)
  controller.preload()
  controller.setEnabled(true)
  assert.equal(loads, 1)
  assert.equal(applied.at(-1), 'prepared maps')
  controller.dispose()
  assert.deepEqual(released, ['prepared maps'])
})

test('entering Planner before the initial preload finishes shares the pending load', async () => {
  let loads = 0
  let finish!: (value: string) => void
  const applied: (string | null)[] = []
  const controller = createGlobeQualityController(() => {
    loads++
    return new Promise<string>(resolve => { finish = resolve })
  }, value => applied.push(value), () => {})
  controller.preload()
  controller.setEnabled(true)
  assert.equal(loads, 1)
  assert.deepEqual(applied, [])
  finish('prepared maps')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied, ['prepared maps'])
  controller.dispose()
})

test('unmount during the initial preload releases the late resource without applying it', async () => {
  let finish!: (value: string) => void
  const applied: (string | null)[] = []
  const released: string[] = []
  const controller = createGlobeQualityController(() => new Promise<string>(resolve => { finish = resolve }), value => applied.push(value), value => released.push(value))
  controller.preload()
  controller.dispose()
  controller.preload()
  finish('late maps')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied, [])
  assert.deepEqual(released, ['late maps'])
})

test('leaving Planner during loading keeps the home texture and still caches the upgrade', async () => {
  let finish!: (value: string) => void
  const applied: (string | null)[] = []
  const controller = createGlobeQualityController(() => new Promise<string>(resolve => { finish = resolve }), value => applied.push(value), () => {})
  controller.setEnabled(true)
  controller.setEnabled(true)
  controller.setEnabled(false)
  finish('detailed map')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied, [null])
  controller.setEnabled(true)
  assert.equal(applied.at(-1), 'detailed map')
  controller.dispose()
})

test('failed requests keep the base globe, and late downloads are released after unmount', async () => {
  let attempts = 0
  let finish!: (value: string) => void
  const applied: (string | null)[] = []
  const released: string[] = []
  const controller = createGlobeQualityController(() => {
    if (++attempts === 1) return Promise.reject(new Error('offline'))
    return new Promise<string>(resolve => { finish = resolve })
  }, value => applied.push(value), value => released.push(value))
  controller.setEnabled(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(applied, [])
  controller.setEnabled(true)
  controller.dispose()
  finish('late map')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(released, ['late map'])
  assert.deepEqual(applied, [])
})
