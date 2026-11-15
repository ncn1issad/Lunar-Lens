import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'http://localhost:5173/#plan' })
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, sessionStorage: window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: PlanningSubmit } = await import('../src/PlanningSubmit.tsx')
const { default: PlanningTime } = await import('../src/PlanningTime.tsx')
const { default: PlanningLocation } = await import('../src/PlanningLocation.tsx')
type PlanningTimeRange = import('../src/planning-time.ts').PlanningTimeRange
type TimelineResponse = import('@lunar-lense/contracts').TimelineResponse
const originalFetch = globalThis.fetch
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let calls: { url: string; signal: AbortSignal }[]
let respond: (response: Response) => void
let reject: (error: Error) => void
let successes: number
let receivedTimeline: TimelineResponse | null

function Harness() {
  const [timeRange, setTimeRange] = useState<PlanningTimeRange | null>(null)
  const [siteDraft, setSiteDraft] = useState({ latitude: '14', longitude: '-57' })
  return createElement('div', null,
    createElement(PlanningTime, { embedded: true, onRangeChange: setTimeRange }),
    createElement(PlanningLocation, { value: siteDraft, onChange: setSiteDraft }),
    createElement(PlanningSubmit, { timeRange, siteDraft, visible: true, onSuccess: (timeline: TimelineResponse) => {
      successes++
      receivedTimeline = timeline
    } }),
  )
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  assert.ok(element, selector)
  return element
}
async function click(selector: string) {
  await act(async () => find<HTMLElement>(selector).click())
}
async function input(selector: string, value: string) {
  await act(async () => {
    const field = find<HTMLInputElement>(selector)
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  window.sessionStorage.clear()
  window.sessionStorage.setItem('lunar-lense:planning-time', JSON.stringify({
    startDate: '2026-05-30', endDate: '2026-06-03', startTime: '09:00', endTime: '17:00',
  }))
  calls = []
  successes = 0
  receivedTimeline = null
  globalThis.fetch = (url, options) => {
    calls.push({ url: String(url), signal: options!.signal! })
    return new Promise<Response>((resolve, fail) => { respond = resolve; reject = fail })
  }
  container = window.document.createElement('div') as unknown as HTMLDivElement
  window.document.body.appendChild(container as never)
  root = createRoot(container)
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  globalThis.fetch = originalFetch
})
after(async () => { await window.happyDOM.close() })

test('submit sends the current UTC range and coordinates only after a click', async () => {
  assert.equal(calls.length, 0)
  await input('#site-longitude', '303')
  await click('#times-heading')
  await click('[aria-label="Edit start minutes"]')
  await act(async () => find('[aria-label="Start minutes"]').dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }),
  ))
  await click('[type="submit"]')
  assert.equal(calls.length, 1)
  const url = new URL(calls[0].url, window.location.origin)
  assert.equal(url.pathname, '/api/timeline')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    start: '2026-05-30T09:05:00Z', end: '2026-06-03T17:00:00Z',
    latitude: '14', longitude: '-57', stepMinutes: '60',
  })
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, true)
  assert.match(find('.planning-submit').textContent!, /Submitting/)
  await act(async () => find('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })))
  assert.equal(calls.length, 1)
})

test('incomplete dates and invalid coordinates disable submission', async () => {
  await click('[data-day="2026-05-30"]')
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, true)
  assert.match(find('.range-feedback').textContent!, /Select an end date/)
  await click('[data-day="2026-06-03"]')
  await input('#site-latitude', '91')
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, true)
  assert.match(find('#location-feedback').textContent!, /Latitude must/)
  assert.equal(calls.length, 0)
})

test('a successful response passes the timeline to the surface page only after it loads', async () => {
  await click('[type="submit"]')
  assert.equal(successes, 0)
  const timeline = {
    range: { start: '2026-05-30T09:00:00Z', end: '2026-06-03T17:00:00Z', sampleCount: 105 },
    positions: { earth: [], sun: [] },
  }
  await act(async () => respond(Response.json(timeline)))
  assert.equal(successes, 1)
  assert.deepEqual(receivedTimeline, timeline)
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, false)
  assert.equal(find('.planning-submit').textContent!.trim(), 'Submit')
  assert.equal(container.querySelector('.planning-submit-feedback'), null)
  assert.equal(container.querySelector('.planning-submit [role="status"]'), null)
})

test('API and network errors permit a retry with the latest selections', async () => {
  await click('[type="submit"]')
  await act(async () => respond(Response.json({ error: { message: 'NASA is temporarily unavailable.' } }, { status: 502 })))
  assert.equal(find('.planning-submit [role="alert"]').textContent, 'NASA is temporarily unavailable.')
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, false)
  await click('[type="submit"]')
  assert.equal(calls.length, 2)
  await act(async () => reject(new TypeError('Failed to fetch')))
  assert.equal(find('.planning-submit [role="alert"]').textContent, 'Failed to fetch')
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, false)
  assert.equal(successes, 0)
})

test('changing selections aborts pending work and ignores a late response', async () => {
  await click('[type="submit"]')
  const staleRespond = respond
  await input('#site-latitude', '-90')
  assert.equal(calls[0].signal.aborted, true)
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, false)
  await click('[type="submit"]')
  assert.equal(new URL(calls[1].url, window.location.origin).searchParams.get('latitude'), '-90')
  await act(async () => staleRespond(Response.json({ range: { sampleCount: 999 } })))
  assert.equal(successes, 0)
  assert.doesNotMatch(find('.planning-submit').textContent!, /999/)
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, true)
  const signal = calls[1].signal
  await act(async () => root.render(null))
  assert.equal(signal.aborted, true)
})
