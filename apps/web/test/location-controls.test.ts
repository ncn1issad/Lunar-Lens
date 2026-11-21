import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'http://localhost:5173/#location' })
for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, sessionStorage: window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
const { act, createElement, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: PlanningLocation } = await import('../src/PlanningLocation.tsx')
const { default: PlanningTime } = await import('../src/PlanningTime.tsx')
const { default: PlanningSubmit } = await import('../src/PlanningSubmit.tsx')
const { initialLocationDraft, locationDraft, LOCATION_STORAGE_KEY } = await import('../src/planning-location.ts')
type RecentPlan = import('../src/recent-plans.ts').RecentPlan
type PlanningTimeRange = import('../src/planning-time.ts').PlanningTimeRange
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
function Harness({ recentPlans = [], withTime = false }: { recentPlans?: RecentPlan[]; withTime?: boolean }) {
  const [value, onChange] = useState(initialLocationDraft)
  const [timeRange, setTimeRange] = useState<PlanningTimeRange | null>(null)
  const [restored, setRestored] = useState<{ range?: PlanningTimeRange; revision: number }>({ revision: 0 })
  return createElement('div', null,
    withTime && createElement(PlanningTime, {
      key: restored.revision, embedded: true, initialValue: restored.range, onRangeChange: setTimeRange,
    }),
    createElement(PlanningLocation, { value, onChange, recentPlans, timeRange, onRecentSelect: plan => {
      onChange(locationDraft(plan.location))
      setTimeRange(plan.range)
      setRestored(current => ({ range: plan.range, revision: current.revision + 1 }))
    } }),
    withTime && createElement(PlanningSubmit, { timeRange, siteDraft: value, visible: true, onSuccess: () => {} }),
  )
}
const recentPlans: RecentPlan[] = [
  { id: 'first', location: { latitude: -42.12345, longitude: 87.65432 },
    range: { startDate: '2027-12-31', endDate: '2028-01-02', startTime: '03:15', endTime: '18:45' },
    visibility: 'linear-gradient(to right, #a6e3a1 0% 25%, #f9e2af 25% 50%, #b4befe 50% 75%, #6c7086 75% 100%)' },
  { id: 'second', location: { latitude: -42.12345, longitude: 87.65432 },
    range: { startDate: '2026-11-15', endDate: '2026-11-16', startTime: '12:00', endTime: '14:00' },
    visibility: 'linear-gradient(to right, #b4befe 0% 100%)' },
]
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  assert.ok(element, selector)
  return element
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
  container = window.document.createElement('div') as unknown as HTMLDivElement
  window.document.body.appendChild(container as never)
  root = createRoot(container)
  await act(async () => root.render(createElement(Harness)))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
after(async () => { await window.happyDOM.close() })

async function openRegions() {
  await act(async () => {
    find<HTMLInputElement>('[role=combobox]').focus()
    find<HTMLInputElement>('[role=combobox]').click()
  })
}

test('searching regions and selecting a result updates both coordinates', async () => {
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '-57')
  await openRegions()
  await input('[role=combobox]', 'aPoLlO 11')
  assert.equal(container.querySelectorAll('[role=option]').length, 1)
  await act(async () => find<HTMLElement>('[role=option]').click())
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '0.67416')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '23.47314')
  assert.equal(find('[role=combobox]').getAttribute('aria-expanded'), 'false')
  await openRegions()
  assert.match(find('[role=option][aria-selected=true]').textContent!, /Apollo 11/)
})

test('region search is collapsed above the full-width recent locations', async () => {
  assert.equal(container.querySelector('[role=listbox]'), null)
  assert.equal(find('[role=combobox]').getAttribute('aria-expanded'), 'false')
  await openRegions()
  assert.equal(container.querySelectorAll('[role=option]').length, 9)
  assert.equal(find('[aria-label="Recent plans"]').querySelectorAll('button').length, 0)
  assert.match(find('.location-empty').textContent!, /after you submit/)
})

test('recent custom locations can be selected again without adding them to the presets', async () => {
  await act(async () => root.render(createElement(Harness, {
    recentPlans,
  })))
  const recent = find('[aria-label="Recent plans"]')
  assert.equal(recent.querySelectorAll('button').length, 2)
  assert.equal(container.querySelector('.location-empty'), null)
  await act(async () => recent.querySelector<HTMLButtonElement>('button')!.click())
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '-42.12345')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '87.65432')
  assert.equal(recent.querySelector('button')!.getAttribute('aria-pressed'), 'true')
  assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 1)
  assert.match(recent.querySelector('.location-recent-dates')!.textContent!, /31 Dec 2027, 03:15to 2 Jan 2028, 18:45 UTC/)
  assert.match(recent.querySelector('.location-recent-timeline')!.getAttribute('style')!, /#a6e3a1|rgb\(166, 227, 161\)/)
  await openRegions()
  assert.equal(container.querySelectorAll('[role=option]').length, 9)
})

test('a recent plan restores both calendars and clocks and the next submission uses its saved UTC range', async context => {
  const calls: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(String(url))
    return Response.json({ error: { message: 'Test response' } }, { status: 503 })
  })
  await act(async () => root.render(createElement(Harness, { recentPlans, withTime: true })))
  const selectRecent = async (index: number) => act(async () => {
    container.querySelectorAll<HTMLButtonElement>('.location-list button')[index]!.click()
  })
  await selectRecent(0)
  assert.equal(calls.length, 0, 'Restoring a plan does not request another timeline')
  assert.equal(find('.calendar-month h3').textContent, 'December 2027')
  assert.equal(find('[data-day="2027-12-31"]').closest('td')!.getAttribute('aria-selected'), 'true')
  assert.equal(find('[data-day="2028-01-02"]').closest('td')!.getAttribute('aria-selected'), 'true')
  assert.equal(find('[aria-label="Edit start hours"]').textContent, '03')
  assert.equal(find('[aria-label="Edit start minutes"]').textContent, '15')
  assert.equal(find('[aria-label="End PM"]').getAttribute('aria-pressed'), 'true')
  assert.equal(find('[aria-label="Edit end hours"]').textContent, '06')
  assert.equal(find('[aria-label="Edit end minutes"]').textContent, '45')
  await act(async () => find<HTMLButtonElement>('[type="submit"]').click())
  const { longitude, ...submitted } = Object.fromEntries(new URL(calls[0]!, window.location.origin).searchParams)
  assert.ok(Math.abs(Number(longitude) - 87.65432) < 1e-10)
  assert.deepEqual(submitted, {
    start: '2027-12-31T03:15:00Z', end: '2028-01-02T18:45:00Z', latitude: '-42.12345', stepMinutes: '60',
  })
  await selectRecent(1)
  assert.equal(find('.calendar-month h3').textContent, 'November 2026')
  assert.match(find('.range-section-summary').textContent!, /15 Nov 2026/)
  assert.equal(container.querySelectorAll('.location-list [aria-pressed="true"]').length, 1)
  assert.equal(container.querySelectorAll('.location-list button')[0]!.getAttribute('aria-pressed'), 'false')
  assert.equal(container.querySelectorAll('.location-list button')[1]!.getAttribute('aria-pressed'), 'true')
  await act(async () => find<HTMLButtonElement>('[data-day="2026-11-15"]').click())
  assert.equal(container.querySelectorAll('.location-list [aria-pressed="true"]').length, 0)
  assert.equal(find<HTMLButtonElement>('[type="submit"]').disabled, true)
})

test('typed coordinates validate globally and match equivalent east-positive presets', async () => {
  await input('#site-longitude', '303')
  await openRegions()
  assert.match(find('[role=option][aria-selected=true]').textContent!, /Marius Hills/)
  await input('#site-latitude', '91')
  assert.match(find('#location-feedback').textContent!, /Latitude must/)
  await input('#site-latitude', '-90')
  await input('#site-longitude', '360')
  assert.match(find('#location-feedback').textContent!, /90.00° S/)
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '360')
})

test('saved valid coordinates restore while malformed storage falls back to Marius Hills', () => {
  window.sessionStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ latitude: '-80', longitude: '135' }))
  assert.deepEqual(initialLocationDraft(), { latitude: '-80', longitude: '135' })
  window.sessionStorage.setItem(LOCATION_STORAGE_KEY, '{broken')
  assert.deepEqual(initialLocationDraft(), { latitude: '14', longitude: '-57' })
})


test('region search handles no matches and can be cleared without changing coordinates', async () => {
  await openRegions()
  await input('[role=combobox]', 'unknown region')
  assert.equal(container.querySelectorAll('[role=option]').length, 0)
  assert.match(find('.location-region-results [role=status]').textContent!, /No presets found/)
  await act(async () => find<HTMLButtonElement>('[aria-label="Clear preset search"]').click())
  assert.equal(find<HTMLInputElement>('[role=combobox]').value, '')
  assert.equal(container.querySelectorAll('[role=option]').length, 9)
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '14')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '-57')
})

test('keyboard navigation selects regions and Escape and outside focus dismiss results', async () => {
  const key = async (key: string) => act(async () => {
    find('[role=combobox]').dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }))
  })
  await openRegions()
  await input('[role=combobox]', 'pole')
  await key('ArrowDown')
  assert.equal(find('[role=combobox]').getAttribute('aria-activedescendant'), find('[role=option]').id)
  await key('ArrowDown')
  await key('Enter')
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '90')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '0')
  assert.equal(find('[role=combobox]').getAttribute('aria-expanded'), 'false')
  await key('ArrowUp')
  assert.equal(find('[role=combobox]').getAttribute('aria-activedescendant'), container.querySelectorAll('[role=option]')[8].id)
  await key('Escape')
  assert.equal(container.querySelector('[role=listbox]'), null)
  await key('ArrowDown')
  await act(async () => find<HTMLInputElement>('#site-latitude').focus())
  assert.equal(container.querySelector('[role=listbox]'), null)
})
