import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'
import type { TimelinePositions } from '@lunar-lense/contracts'
import { visibilityGradient } from '../src/surface-timeline.ts'

const window = new Window({ url: 'http://localhost/' })
for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: SurfaceTimeline } = await import('../src/SurfaceTimeline.tsx')
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let input: HTMLInputElement
let commits: number[]
const start = Date.parse('2026-11-15T12:00:00Z'), end = start + 86400000

function positions(): TimelinePositions {
  const samples = [0, 1, 2, 3, 4].map(index => ({ timestamp: new Date(start + index * 21600000).toISOString(), azimuthDeg: 0, elevationDeg: -20, isVisible: false }))
  return { earth: samples.map((sample, index) => ({ ...sample, isVisible: index === 0 || index === 2 })),
    sun: samples.map((sample, index) => ({ ...sample, isVisible: index === 0 || index === 1 })) }
}

beforeEach(async () => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  commits = []
  await act(async () => root.render(createElement(SurfaceTimeline, { positions: positions(), selected: start, onSelect: time => commits.push(time) })))
  input = host.querySelector('input')!
  input.setPointerCapture = () => {}
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
after(async () => window.happyDOM.close())

async function pointer(type: string) {
  await act(async () => input.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0 }) as never))
}
async function change(time: number) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, String((time - start) / 1000))
    input.dispatchEvent(new window.Event('input', { bubbles: true }) as never)
  })
}

test('dragging previews time and commits only the release value', async () => {
  await pointer('pointerdown')
  await change(start + 3600000)
  await change(start + 7200000)
  assert.deepEqual(commits, [])
  assert.match(host.querySelector('output')!.textContent!, /14:00:00 UTC/)
  await pointer('pointerup')
  assert.deepEqual(commits, [start + 7200000])
})

test('a track click commits on release and a cancelled touch restores the selected time', async () => {
  await pointer('pointerdown')
  await change(start + 3600000)
  await pointer('pointerup')
  assert.deepEqual(commits, [start + 3600000])
  commits.length = 0
  await pointer('pointerdown')
  await change(end)
  await pointer('pointercancel')
  assert.deepEqual(commits, [])
  assert.equal(Number(input.value), 0)
})

test('keyboard and assistive input commit without a pointer gesture', async () => {
  await change(start + 1000)
  assert.deepEqual(commits, [start + 1000])
  assert.equal(input.getAttribute('aria-valuetext'), '2026-11-15 12:00:00 UTC')
})

test('older single-scene submissions show a disabled timeline', async () => {
  await act(async () => root.render(createElement(SurfaceTimeline, { positions: { earth: [positions().earth[0]!], sun: [positions().sun[0]!] }, selected: start, onSelect: time => commits.push(time) })))
  assert.equal(input.disabled, true)
  assert.match(input.title, /Submit a new time range/)
})


test('track colors use API flags for all four states, even when elevations disagree', () => {
  assert.equal(visibilityGradient(positions()), 'linear-gradient(to right, #a6e3a1 0% 25%, #f9e2af 25% 50%, #b4befe 50% 75%, #6c7086 75% 100%)')
})

test('visibility bands follow timestamps rather than equal sample widths', () => {
  const samples = positions()
  samples.earth[1]!.timestamp = samples.sun[1]!.timestamp = new Date(start + 3600000).toISOString()
  assert.match(visibilityGradient(samples), /#a6e3a1 0% 4\.166666666666666%/)
  samples.earth.forEach(sample => { sample.isVisible = true })
  samples.sun.forEach(sample => { sample.isVisible = false })
  assert.equal(visibilityGradient(samples), 'linear-gradient(to right, #b4befe 0% 100%)')
})

test('the opening overlay lasts three seconds and touch can reveal it again', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  await act(async () => root.render(createElement(SurfaceTimeline, { key: 'intro', positions: positions(), selected: start, onSelect: time => commits.push(time) })))
  const overlay = host.querySelector('.surface-timeline-overlay')!
  assert.equal(overlay.getAttribute('data-intro-visible'), 'true')
  await act(async () => context.mock.timers.tick(2999))
  assert.equal(overlay.getAttribute('data-intro-visible'), 'true')
  await act(async () => context.mock.timers.tick(1))
  assert.equal(overlay.getAttribute('data-intro-visible'), 'false')
  await act(async () => overlay.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }) as never))
  assert.equal(overlay.getAttribute('data-intro-visible'), 'true')
  await act(async () => context.mock.timers.tick(3000))
  assert.equal(overlay.getAttribute('data-intro-visible'), 'false')
  assert.equal(host.textContent, 'Surface time2026-11-15 12:00:00 UTC')
})
