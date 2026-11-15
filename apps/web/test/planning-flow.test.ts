import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'

const window = new Window({ url: 'http://localhost:5173/' })
const observers: { callback: () => void }[] = []
class MockResizeObserver {
  callback: () => void
  constructor(callback: () => void) { this.callback = callback; observers.push(this) }
  observe() {}
  disconnect() {}
}
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, ResizeObserver: MockResizeObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: PlanningFlow } = await import('../src/PlanningFlow.tsx')
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let viewport: HTMLDivElement
let scrollCalls: ScrollToOptions[]
let progressChanges: number[]
let locationProgressChanges: number[]

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  assert.ok(element, selector)
  return element
}

beforeEach(async () => {
  observers.length = 0
  window.history.replaceState(null, '', '/')
  container = window.document.createElement('div') as unknown as HTMLDivElement
  window.document.body.appendChild(container as never)
  root = createRoot(container)
  progressChanges = []
  locationProgressChanges = []
  await act(async () => root.render(createElement(PlanningFlow, {
    backdrop: createElement('canvas', { 'aria-label': 'Moon scene' }),
    onProgressChange: (progress, locationProgress) => { progressChanges.push(progress); locationProgressChanges.push(locationProgress) },
  },
    createElement('section', { id: 'home', className: 'flow-step', tabIndex: -1 }, createElement('a', { href: '#plan' }, 'Start planning')),
    createElement('section', { id: 'plan', className: 'flow-step', tabIndex: -1 }, createElement('input', { 'aria-label': 'Retained input', defaultValue: '09:30' })),
    createElement('section', { id: 'location', className: 'flow-step', tabIndex: -1 }, 'Lunar location selector'),
    createElement('section', { id: 'surface', className: 'flow-step', tabIndex: -1 }, 'Fixed Moon surface preview'),
  )))
  viewport = find<HTMLDivElement>('.flow-viewport')
  find('.flow-column').getBoundingClientRect = () => ({ left: 88, width: 560 }) as DOMRect
  scrollCalls = []
  Object.defineProperty(viewport, 'clientHeight', { value: 600, configurable: true })
  viewport.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 }) as DOMRect
  viewport.scrollTo = (options: ScrollToOptions | number) => {
    assert.equal(typeof options, 'object')
    scrollCalls.push(options as ScrollToOptions)
    viewport.scrollTop = (options as ScrollToOptions).top ?? 0
  }
  for (const [id, top, height] of [['home', 0, 600], ['plan', 600, 1000], ['location', 1600, 600], ['surface', 2200, 600]] as const) {
    const section = find(`#${id}`)
    Object.defineProperties(section, { offsetTop: { value: top }, offsetHeight: { value: height } })
    section.getBoundingClientRect = () => ({ top: top - viewport.scrollTop, bottom: top - viewport.scrollTop + height, height }) as DOMRect
  }
  await act(async () => observers.forEach(observer => observer.callback()))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
after(async () => { await window.happyDOM.close() })

test('Start planning scrolls to the input in the same page and keeps it mounted', async () => {
  const input = find<HTMLInputElement>('input')
  await act(async () => find<HTMLAnchorElement>('#home a').click())
  assert.equal(scrollCalls.at(-1)?.top, 600)
  assert.equal(window.location.hash, '#plan')
  assert.equal(find('.flow-navigation a[href="#plan"]').getAttribute('aria-current'), 'step')
  assert.equal(find('#plan'), window.document.activeElement)
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#home"]').click())
  assert.equal(scrollCalls.at(-1)?.top, 0)
  assert.equal(find('input'), input)
  assert.equal(input.value, '09:30')
})

test('tall steps use a top snap so their remaining controls can scroll into view', () => {
  assert.equal(find('#plan').getAttribute('data-overflow'), 'true')
  assert.equal(find('#home').getAttribute('data-overflow'), 'false')
})

test('the Moon shares the scroll viewport while inputs retain their left-column frame', () => {
  const scene = find('canvas')
  assert.equal(scene.closest('.flow-viewport'), viewport)
  assert.equal(viewport.style.getPropertyValue('--flow-column-left'), '88px')
  assert.equal(viewport.style.getPropertyValue('--flow-column-width'), '560px')
  const wheel = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
  scene.dispatchEvent(wheel)
  assert.equal(wheel.defaultPrevented, false)
})

test('scrolling updates the section reference and page title', async () => {
  await act(async () => {
    viewport.scrollTop = 900
    viewport.dispatchEvent(new window.Event('scroll'))
    await new Promise(resolve => window.requestAnimationFrame(resolve))
  })
  assert.equal(find('.flow-navigation a[href="#plan"]').getAttribute('aria-current'), 'step')
  assert.equal(window.document.title, 'Time range | Lunar Lense')
  assert.equal(progressChanges.at(-1), 1)
})

test('the Moon framing progresses with scroll and restores on the way home', async () => {
  for (const [top, expected] of [[300, 0.5], [600, 1], [1000, 1], [0, 0]] as const) {
    await act(async () => {
      viewport.scrollTop = top
      viewport.dispatchEvent(new window.Event('scroll'))
      await new Promise(resolve => window.requestAnimationFrame(resolve))
    })
    assert.equal(progressChanges.at(-1), expected)
  }
})

test('hash navigation jumps to the requested section without an animation', async () => {
  await act(async () => {
    window.history.replaceState(null, '', '#plan')
    window.dispatchEvent(new window.HashChangeEvent('hashchange'))
  })
  assert.equal(scrollCalls.at(-1)?.top, 600)
  assert.equal(scrollCalls.at(-1)?.behavior, 'instant')
})

test('Surface opens the preview below the time picker and keeps the selected time mounted', async () => {
  const input = find<HTMLInputElement>('input')
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#surface"]').click())
  assert.equal(scrollCalls.at(-1)?.top, 2200)
  assert.equal(window.location.hash, '#surface')
  assert.equal(find('#surface'), window.document.activeElement)
  assert.equal(window.document.title, 'Moon surface | Lunar Lense')
  assert.equal(find('input'), input)
  assert.equal(input.value, '09:30')
})

test('Location navigation retains the mounted time input and supports returning to Time', async () => {
  const input = find<HTMLInputElement>('input')
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#location"]').click())
  assert.equal(scrollCalls.at(-1)?.top, 1600)
  assert.equal(window.location.hash, '#location')
  assert.equal(window.document.title, 'Location | Lunar Lense')
  assert.equal(find('#location'), window.document.activeElement)
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#plan"]').click())
  assert.equal(scrollCalls.at(-1)?.top, 600)
  assert.equal(find('input'), input)
})

test('the location transition follows scroll and the new section wins over a sticky time section', async () => {
  find('#plan').getBoundingClientRect = () => ({ top: 0, bottom: 1000, height: 1000 }) as DOMRect
  for (const [top, expected] of [[600, 0], [1100, 0.5], [1600, 1]] as const) {
    await act(async () => {
      viewport.scrollTop = top
      viewport.dispatchEvent(new window.Event('scroll'))
      await new Promise(resolve => window.requestAnimationFrame(resolve))
    })
    assert.equal(locationProgressChanges.at(-1), expected)
  }
  assert.equal(find('.flow-navigation a[href="#location"]').getAttribute('aria-current'), 'step')
  assert.equal(window.document.title, 'Location | Lunar Lense')
})
