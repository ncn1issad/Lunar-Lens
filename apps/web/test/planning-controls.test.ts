import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'http://localhost:5173/#plan' })
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, sessionStorage: window.sessionStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

const { act, createElement, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: PlanningTime } = await import('../src/PlanningTime.tsx')
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let previewTimes: number[]

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  assert.ok(element, `Missing ${selector}`)
  return element
}
async function click(selector: string) {
  await act(async () => find<HTMLElement>(selector).click())
}
async function setSelect(selector: string, value: string) {
  await act(async () => {
    const select = find<HTMLSelectElement>(selector)
    select.value = value
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  })
}
function storedTime(label: 'Start' | 'End') {
  return JSON.parse(window.sessionStorage.getItem('lunar-lense:planning-time')!)[`${label.toLowerCase()}Time`]
}
async function clockKey(label: 'Start' | 'End', unit: 'hours' | 'minutes', key: string) {
  await click(`[aria-label="Edit ${label.toLowerCase()} ${unit}"]`)
  await act(async () => find(`[aria-label="${label} ${unit}"]`).dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })))
}
async function waitForHover() {
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 330)) })
}

beforeEach(async () => {
  window.sessionStorage.clear()
  window.sessionStorage.setItem('lunar-lense:planning-time', JSON.stringify({
    startDate: '2026-05-30', endDate: '2026-06-03', startTime: '09:00', endTime: '17:00',
  }))
  container = window.document.createElement('div') as unknown as HTMLDivElement
  window.document.body.appendChild(container as never)
  root = createRoot(container)
  previewTimes = []
  await act(async () => root.render(createElement(StrictMode, null, createElement(PlanningTime, {
    onPreviewTimeChange: timestamp => previewTimes.push(timestamp),
  }))))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
after(async () => { await window.happyDOM.close() })

test('exactly one accordion panel stays open, including repeated clicks', async () => {
  const visiblePanels = () => container.querySelectorAll('.range-section-panel:not([hidden])').length
  assert.equal(visiblePanels(), 1)
  assert.equal(find('#dates-heading').getAttribute('aria-expanded'), 'true')
  await click('#dates-heading')
  assert.equal(visiblePanels(), 1)
  await click('#times-heading')
  assert.equal(find('#dates-panel').hasAttribute('hidden'), true)
  assert.equal(find('#times-panel').hasAttribute('hidden'), false)
  await click('#times-heading')
  assert.equal(visiblePanels(), 1)
})

test('range selection highlights all days across the two visible months', async () => {
  assert.equal(container.querySelectorAll('.calendar-month').length, 2)
  await click('[data-day="2026-05-30"]')
  assert.match(find('.calendar-instruction').textContent!, /end date/)
  await click('[data-day="2026-06-03"]')
  const selected = [...container.querySelectorAll('td[aria-selected="true"] button')].map(button => button.getAttribute('data-day'))
  assert.deepEqual(selected, ['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02', '2026-06-03'])
  await click('#times-heading')
  await click('#dates-heading')
  assert.equal(container.querySelectorAll('td[aria-selected="true"]').length, 5)
})

test('arrow keys move calendar focus across a month boundary', async () => {
  const day = find<HTMLButtonElement>('[data-day="2026-05-31"]')
  await act(async () => day.focus())
  await act(async () => day.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  assert.equal(window.document.activeElement?.getAttribute('data-day'), '2026-06-01')
  assert.equal(find('[data-day="2026-06-01"]').getAttribute('tabindex'), '0')
})

test('hover previews any calendar day without editing the range, then restores the selected endpoint', async () => {
  assert.equal(previewTimes.at(-1), Date.parse('2026-06-03T17:00:00Z'))
  const stored = window.sessionStorage.getItem('lunar-lense:planning-time')
  const day = find('[data-day="2026-05-31"]')
  await act(async () => day.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
  assert.equal(previewTimes.at(-1), Date.parse('2026-06-03T17:00:00Z'))
  await waitForHover()
  assert.equal(previewTimes.at(-1), Date.parse('2026-05-31T09:00:00Z'))
  assert.equal(window.sessionStorage.getItem('lunar-lense:planning-time'), stored)
  await act(async () => day.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body })))
  await waitForHover()
  assert.equal(previewTimes.at(-1), Date.parse('2026-06-03T17:00:00Z'))
})

test('the most recent date click remains the preview after a reversed range and switching panels', async () => {
  await click('[data-day="2026-05-31"]')
  await click('[data-day="2026-05-30"]')
  assert.equal(previewTimes.at(-1), Date.parse('2026-05-30T09:00:00Z'))
  await act(async () => find('[data-day="2026-06-01"]').dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
  await waitForHover()
  assert.equal(previewTimes.at(-1), Date.parse('2026-06-01T09:00:00Z'))
  await click('#times-heading')
  assert.equal(previewTimes.at(-1), Date.parse('2026-05-30T09:00:00Z'))
  await clockKey('Start', 'minutes', 'PageUp')
  assert.equal(previewTimes.at(-1), Date.parse('2026-05-30T09:05:00Z'))
})

test('moving between days keeps the preview during the hover delay instead of returning to the selection', async () => {
  const first = find('[data-day="2026-05-31"]')
  const next = find('[data-day="2026-06-01"]')
  await act(async () => first.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
  await waitForHover()
  const previousPreview = previewTimes.at(-1)
  await act(async () => first.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: window.document.body })))
  assert.equal(previewTimes.at(-1), previousPreview)
  await act(async () => next.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true })))
  assert.equal(previewTimes.at(-1), previousPreview)
  await waitForHover()
  assert.equal(previewTimes.at(-1), Date.parse('2026-06-01T09:00:00Z'))
  assert.ok(!previewTimes.slice(previewTimes.indexOf(previousPreview!) + 1).includes(Date.parse('2026-06-03T17:00:00Z')))
})

test('month and year controls allow a range across New Year', async () => {
  await setSelect('[aria-label="Calendar month"]', '11')
  await setSelect('[aria-label="Calendar year"]', '2027')
  assert.equal(find('.calendar-month h3').textContent, 'December 2027')
  await click('[data-day="2027-12-31"]')
  await click('[data-day="2028-01-02"]')
  const selected = [...container.querySelectorAll('td[aria-selected="true"] button')].map(button => button.getAttribute('data-day'))
  assert.deepEqual(selected, ['2027-12-31', '2028-01-01', '2028-01-02'])
})

test('clock controls and AM/PM selectors distinguish midnight and noon without text fields', async () => {
  await click('#times-heading')
  assert.equal(container.querySelector('input'), null)
  await clockKey('Start', 'hours', 'End')
  await clockKey('Start', 'minutes', 'End')
  assert.equal(storedTime('Start'), '00:59')
  await click('[aria-label="Start PM"]')
  assert.equal(storedTime('Start'), '12:59')
  await clockKey('Start', 'minutes', 'Home')
  assert.equal(storedTime('Start'), '12:00')
  await click('[aria-label="Start AM"]')
  assert.equal(storedTime('Start'), '00:00')
})

test('clock keyboard controls change exact minutes and keep the period', async () => {
  await click('#times-heading')
  await clockKey('End', 'minutes', 'ArrowRight')
  assert.equal(storedTime('End'), '17:01')
  assert.equal(find('[aria-label="End PM"]').getAttribute('aria-pressed'), 'true')
})

test('pointer selection picks hours, advances to minutes, and accepts a touch drag', async () => {
  await click('#times-heading')
  const dial = find<HTMLElement>('[aria-label="Start hours"]')
  const captured = new Set<number>()
  Object.assign(dial, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 240 }),
  })
  const pointer = async (type: string, x: number, y: number) => {
    await act(async () => dial.dispatchEvent(new window.PointerEvent(type, {
      bubbles: true, pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y,
    })))
  }
  await pointer('pointerdown', 200, 120)
  await pointer('pointerup', 200, 120)
  assert.equal(storedTime('Start'), '03:00')
  assert.equal(dial.getAttribute('aria-label'), 'Start minutes')
  await pointer('pointerdown', 120, 200)
  const radians = 17 * Math.PI / 30
  await pointer('pointermove', 120 + 80 * Math.sin(radians), 120 - 80 * Math.cos(radians))
  await pointer('pointerup', 120 + 80 * Math.sin(radians), 120 - 80 * Math.cos(radians))
  assert.equal(storedTime('Start'), '03:17')
  assert.equal(captured.size, 0)
  await click('[aria-label="Start PM"]')
  assert.equal(storedTime('Start'), '15:17')
})

test('clock changes persist automatically and restore on remount', async () => {
  assert.equal(container.querySelector('button[type="submit"]'), null)
  assert.equal(container.querySelector('form'), null)
  await click('#times-heading')
  await clockKey('Start', 'minutes', 'PageUp')
  assert.match(find('.range-feedback').textContent!, /selected/)
  assert.equal(storedTime('Start'), '09:05')
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(createElement(PlanningTime)))
  await click('#times-heading')
  assert.equal(find('[aria-label="Edit start minutes"]').textContent, '05')
  assert.equal(storedTime('Start'), '09:05')
  assert.equal(container.querySelectorAll('td[aria-selected="true"]').length, 5)
})
