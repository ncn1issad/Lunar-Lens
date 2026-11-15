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
const { initialLocationDraft, LOCATION_STORAGE_KEY } = await import('../src/planning-location.ts')
type LunarLocation = import('../src/planning-location.ts').LunarLocation
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
function Harness({ recentLocations = [] }: { recentLocations?: LunarLocation[] }) {
  const [value, onChange] = useState(initialLocationDraft)
  return createElement(PlanningLocation, { value, onChange, recentLocations })
}
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

test('presets update both coordinate fields and the selected row', async () => {
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '-57')
  const apollo = [...container.querySelectorAll<HTMLButtonElement>('.location-list button')].find(button => button.textContent?.includes('Apollo 11'))!
  await act(async () => apollo.click())
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '0.67416')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '23.47314')
  assert.equal(apollo.getAttribute('aria-pressed'), 'true')
  assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 1)
})

test('presets and recent custom locations have separate columns with an empty history hint', () => {
  assert.equal(container.querySelectorAll('.location-column').length, 2)
  assert.equal(find('[aria-label="Preset lunar locations"]').querySelectorAll('button').length, 9)
  assert.equal(find('[aria-label="Recent custom locations"]').querySelectorAll('button').length, 0)
  assert.match(find('.location-empty').textContent!, /after you submit/)
})

test('recent custom locations can be selected again without adding them to the presets', async () => {
  await act(async () => root.render(createElement(Harness, {
    recentLocations: [{ latitude: -42.12345, longitude: 87.65432 }, { latitude: 15, longitude: -57 }],
  })))
  const recent = find('[aria-label="Recent custom locations"]')
  assert.equal(recent.querySelectorAll('button').length, 2)
  assert.equal(container.querySelector('.location-empty'), null)
  await act(async () => recent.querySelector<HTMLButtonElement>('button')!.click())
  assert.equal(find<HTMLInputElement>('#site-latitude').value, '-42.12345')
  assert.equal(find<HTMLInputElement>('#site-longitude').value, '87.65432')
  assert.equal(recent.querySelector('button')!.getAttribute('aria-pressed'), 'true')
  assert.equal(container.querySelectorAll('[aria-pressed="true"]').length, 1)
  assert.equal(find('[aria-label="Preset lunar locations"]').querySelectorAll('button').length, 9)
})

test('typed coordinates validate globally and match equivalent east-positive presets', async () => {
  await input('#site-longitude', '303')
  assert.equal(find('.location-list button').getAttribute('aria-pressed'), 'true')
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
