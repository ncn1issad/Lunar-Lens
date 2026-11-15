import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { PAGE_HOLD, planningScrollLayout, SECTION_LINK_SECONDS } from '../src/planning-scroll'

const window = new Window({ url: 'http://localhost:5173/' })
// Happy DOM emits hashchange for pushState/replaceState; browsers do not.
// History navigation below explicitly dispatches popstate.
window.addEventListener('hashchange', event => event.stopImmediatePropagation())
const observers: { callback: () => void }[] = []
let height = 600
class MockResizeObserver {
  callback: () => void
  constructor(callback: () => void) { this.callback = callback; observers.push(this) }
  observe() {}
  disconnect() {}
}
for (const [name, value] of Object.entries({
  window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Node: window.Node, ResizeObserver: MockResizeObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
})) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })

// Supply browser geometry, including the moving track inside a stationary scroller.
Object.defineProperties(window.HTMLElement.prototype, {
  clientHeight: { configurable: true, get() { return this.classList.contains('flow-viewport') ? height : 0 } },
  scrollHeight: { configurable: true, get() { return this.classList.contains('flow-viewport') ? Number.parseFloat(this.firstElementChild.style.height) : 0 } },
})
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const viewport = this.closest('.flow-viewport')
  const top = this.classList.contains('flow-track') ? -(viewport?.scrollTop ?? 0) : 0
  return { top, bottom: top + height, left: 88, right: 648, width: 560, height, x: 88, y: top, toJSON() {} }
}

const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { ScrollTrigger } = await import('gsap/ScrollTrigger')
const { gsap } = await import('gsap')
const { default: PlanningFlow } = await import('../src/PlanningFlow.tsx')
// Browser motion runs in the preview. These tests advance scroll deterministically.
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let viewport: HTMLDivElement
let scrollCalls: ScrollToOptions[]
let progressChanges: number[]
const targets = planningScrollLayout(600, 3).targets

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = container.querySelector<T>(selector)
  assert.ok(element, selector)
  return element
}
const onProgressChange = (progress: number) => { progressChanges.push(progress) }
function flow(surfaceAvailable = true, surfaceRevision = 0) {
  return createElement(PlanningFlow, { backdrop: createElement('canvas', { 'aria-label': 'Moon scene' }), onProgressChange, surfaceAvailable, surfaceRevision },
    createElement('section', { id: 'home', className: 'flow-step', tabIndex: -1 }, createElement('a', { href: '#planner' }, 'Start planning')),
    createElement('section', { id: 'planner', className: 'flow-step', tabIndex: -1 },
      createElement('input', { 'aria-label': 'Retained time', defaultValue: '09:30' }),
      createElement('input', { 'aria-label': 'Lunar latitude', defaultValue: '14' })),
    surfaceAvailable && createElement('section', { id: 'surface', className: 'flow-step', tabIndex: -1 }, 'Submitted Moon surface'),
  )
}
function navigationTween() {
  return gsap.getTweensOf(viewport).find(tween => tween.vars.scrollTo)
}
async function finishNavigation() {
  await act(async () => { navigationTween()?.progress(1) })
  gsap.ticker.sleep()
}
async function clickLink(selector: string) {
  await act(async () => find<HTMLAnchorElement>(selector).click())
  await finishNavigation()
}
async function scroll(top: number) {
  await act(async () => {
    viewport.scrollTop = top
    viewport.dispatchEvent(new window.Event('scroll'))
    ScrollTrigger.update()
  })
}
beforeEach(async () => {
  height = 600
  window.happyDOM.setWindowSize({ width: 1024, height: 768 })
  window.happyDOM.settings.device.prefersReducedMotion = 'no-preference'
  observers.length = 0
  window.history.replaceState(null, '', '/')
  container = window.document.createElement('div') as unknown as HTMLDivElement
  window.document.body.appendChild(container as never)
  root = createRoot(container)
  progressChanges = []
  scrollCalls = []
  await act(async () => root.render(flow()))
  viewport = find<HTMLDivElement>('.flow-viewport')
  viewport.scrollTo = (options: ScrollToOptions | number) => {
    assert.equal(typeof options, 'object')
    scrollCalls.push(options as ScrollToOptions)
    viewport.scrollTop = (options as ScrollToOptions).top ?? 0
  }
  gsap.ticker.sleep()
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
after(async () => { ScrollTrigger.disable(); gsap.ticker.sleep(); await window.happyDOM.close() })

test('Start planning and section navigation retain the mounted input and move focus', async () => {
  const input = find<HTMLInputElement>('input')
  await clickLink('#home a')
  assert.equal(viewport.scrollTop, targets[1])
  assert.equal(window.location.hash, '#planner')
  assert.equal(find('.flow-navigation a[href="#planner"]').getAttribute('aria-current'), 'step')
  assert.equal(window.document.activeElement?.id, 'planner')
  input.value = '10:45'
  await clickLink('.flow-navigation a[href="#planner"]')
  assert.equal(viewport.scrollTop, targets[1])
  assert.equal(window.document.title, 'Planner | Lunar Lens')
  await clickLink('.flow-navigation a[href="#home"]')
  assert.equal(find('input'), input)
  assert.equal(input.value, '10:45')
})

test('native scroll advances through a stationary hold in either direction', async () => {
  const top = targets[1]
  for (const offset of [-PAGE_HOLD, -120, 0, 120, PAGE_HOLD, 120, 0]) {
    await scroll(top + offset)
    assert.equal(progressChanges.at(-1), 1)
    assert.equal(find('#planner').style.transform, 'translate3d(0px, 0px, 0)')
    assert.equal(find('#planner').style.opacity, '1')
  }
})

test('the Moon and panels follow the same continuous transition and reverse', async () => {
  const { transitions } = planningScrollLayout(height, 3)
  for (const transition of transitions.slice(0, 1)) {
    for (const [fraction, expected] of [[0, 0], [0.5, 0.5], [1, 1], [0.5, 0.5], [0, 0]] as const) {
      await scroll(transition.start + (transition.end - transition.start) * fraction)
      assert.equal(progressChanges.at(-1), expected)
    }
  }
})

test('wheel events over the Moon or a control remain native and are never swallowed', () => {
  for (const target of [find('canvas'), find('input'), viewport]) {
    for (const deltaY of [10, 120, 1800, -120]) {
      const wheel = new window.WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
      target.dispatchEvent(wheel)
      assert.equal(wheel.defaultPrevented, false)
    }
  }
  assert.equal(scrollCalls.length, 0)
  assert.equal(find('canvas').closest('.flow-scene'), find('.flow-scene'))
})

test('Planner keeps both time and location controls together and hides them on Surface', async () => {
  assert.equal(find('#home').inert, false)
  assert.equal(find('#planner').inert, true)
  assert.equal(find('#surface').getAttribute('aria-hidden'), 'true')
  await scroll(targets[1])
  assert.equal(find('#home').inert, true)
  assert.equal(find('#planner').inert, false)
  assert.equal(find('#planner').querySelectorAll('input').length, 2)
  await scroll(targets[2])
  assert.equal(find('#planner').inert, true)
  assert.equal(find('#surface').inert, false)
  assert.equal(find<HTMLElement>('.flow-navigation').hidden, true)
})

test('deep links and browser history use instant navigation to the hold center', async () => {
  for (const id of ['planner', 'home'] as const) {
    await act(async () => {
      window.history.replaceState(null, '', `#${id}`)
      window.dispatchEvent(new window.PopStateEvent('popstate'))
    })
    assert.equal(scrollCalls.at(-1)?.top, targets[['home', 'planner'].indexOf(id)])
    assert.equal(scrollCalls.at(-1)?.behavior, 'instant')
  }
})

test('old Time and Location links open Planner without adding separate steps', async () => {
  await act(async () => root.render(flow(false)))
  assert.deepEqual([...container.querySelectorAll('.flow-navigation a')].map(link => link.textContent), ['Home', 'Planner'])
  for (const hash of ['plan', 'location']) {
    await act(async () => {
      window.history.replaceState(null, '', `#${hash}`)
      window.dispatchEvent(new window.PopStateEvent('popstate'))
    })
    assert.equal(window.location.hash, '#planner')
    assert.equal(viewport.scrollTop, targets[1])
    assert.equal(find('#planner').inert, false)
  }
})

test('adding Surface and replacing callbacks preserve the scene and form state', async () => {
  await act(async () => root.render(flow(false)))
  await scroll(targets[1])
  const input = find<HTMLInputElement>('input')
  input.value = '11:30'
  scrollCalls.length = 0
  await act(async () => root.render(flow(true)))
  assert.equal(viewport.scrollTop, targets[1])
  assert.equal(scrollCalls.length, 0)
  const replacement: number[] = []
  await act(async () => root.render(createElement(PlanningFlow, { ...flow().props, onProgressChange: (value: number) => replacement.push(value) })))
  await scroll(targets[1] + 30)
  assert.equal(viewport.scrollTop, targets[1] + 30)
  assert.equal(find('input'), input)
  assert.equal(input.value, '11:30')
  await scroll(targets[0])
  assert.equal(replacement.at(-1), 0)
})

test('a successful submission opens Surface, including a second submission', async () => {
  const input = find('input')
  for (const revision of [1, 2]) {
    if (revision === 2) await scroll(targets[1])
    await act(async () => root.render(flow(true, revision)))
    assert.equal(navigationTween()?.duration(), SECTION_LINK_SECONDS)
    await finishNavigation()
    assert.equal(viewport.scrollTop, targets[2])
    assert.equal(window.location.hash, '#surface')
    assert.equal(window.document.activeElement?.id, 'surface')
    assert.equal(find('input'), input)
  }
})

test('section links animate over the configured duration and keep the old section until it scrolls away', async () => {
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#planner"]').click())
  const tween = navigationTween()!
  assert.ok(tween)
  assert.equal(tween.duration(), SECTION_LINK_SECONDS)
  assert.equal(viewport.scrollTop, 0)
  assert.equal(find('.flow-navigation a[href="#home"]').getAttribute('aria-current'), 'step')
  await act(async () => { tween.progress(0.25) })
  assert.ok(viewport.scrollTop > 0 && viewport.scrollTop < targets[1])
  assert.equal(find('#home').inert, false)
  await finishNavigation()
  assert.equal(viewport.scrollTop, targets[1])
  assert.equal(find('.flow-navigation a[href="#planner"]').getAttribute('aria-current'), 'step')
  assert.equal(window.document.activeElement?.id, 'planner')
})

test('manual scrolling interrupts link navigation and clears its pending focus', async () => {
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#planner"]').click())
  const tween = navigationTween()!
  await act(async () => { tween.progress(0.2) })
  const top = viewport.scrollTop + 120
  await scroll(top)
  await act(async () => { tween.progress(0.3) })
  assert.equal(navigationTween(), undefined)
  assert.equal(viewport.scrollTop, top)
  await scroll(targets[1])
  assert.notEqual(window.document.activeElement?.id, 'planner')
})

test('new link navigation replaces the previous destination and unmount cancels the animation', async () => {
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#planner"]').click())
  const first = navigationTween()!
  await act(async () => { first.progress(0.5) })
  await act(async () => find<HTMLAnchorElement>('.flow-navigation a[href="#home"]').click())
  const second = navigationTween()!
  assert.ok(second && second !== first)
  assert.equal(gsap.getTweensOf(viewport).length, 1)
  await act(async () => root.unmount())
  assert.equal(gsap.getTweensOf(viewport).length, 0)
})

test('layout measurements do not make the focused page inert or lose keyboard focus', async () => {
  await clickLink('.flow-navigation a[href="#planner"]')
  assert.equal(window.document.activeElement?.id, 'planner')
  await act(async () => ScrollTrigger.refresh())
  assert.equal(window.document.activeElement?.id, 'planner')
  assert.equal(find('#planner').inert, false)
})

test('navigation works when ScrollTrigger reports a completed snap as zero', async () => {
  // GSAP returns 0 after a snap ends, although its declaration says Tween.
  Object.defineProperty(ScrollTrigger.getAll()[0], 'getTween', { value: () => 0 })
  await clickLink('.flow-navigation a[href="#planner"]')
  assert.equal(viewport.scrollTop, targets[1])
  assert.equal(window.document.activeElement?.id, 'planner')
})

test('resizing keeps the current section and unmounting cleans up its ScrollTrigger', async () => {
  await scroll(targets[1])
  height = 800
  await act(async () => {
    observers.forEach(observer => observer.callback())
    await new Promise(resolve => window.requestAnimationFrame(resolve))
  })
  assert.equal(viewport.scrollTop, planningScrollLayout(800, 3).targets[1])
  assert.equal(progressChanges.at(-1), 1)
  assert.equal(ScrollTrigger.getAll().length, 1)
  await act(async () => root.unmount())
  assert.equal(ScrollTrigger.getAll().length, 0)
})

test('phone layouts keep both Planner controls in the same section', async () => {
  await act(async () => root.render(null))
  window.happyDOM.setWindowSize({ width: 390, height: 844 })
  await act(async () => root.render(flow()))
  viewport = find<HTMLDivElement>('.flow-viewport')
  await scroll(targets[1])
  assert.equal(find('#planner').inert, false)
  assert.equal(find('#planner').style.visibility, 'visible')
  assert.equal(find('#planner').querySelectorAll('input').length, 2)
  await scroll(targets[0])
  assert.equal(find('#planner').inert, true)
})

test('reduced motion removes smooth navigation, tweened panels, and automatic settling', async () => {
  await act(async () => root.render(null))
  window.happyDOM.settings.device.prefersReducedMotion = 'reduce'
  await act(async () => root.render(flow()))
  viewport = find<HTMLDivElement>('.flow-viewport')
  viewport.scrollTo = (options: ScrollToOptions | number) => {
    assert.equal(typeof options, 'object')
    scrollCalls.push(options as ScrollToOptions)
    viewport.scrollTop = (options as ScrollToOptions).top ?? 0
  }
  await clickLink('.flow-navigation a[href="#planner"]')
  assert.equal(scrollCalls.at(-1)?.behavior, 'instant')
  assert.equal(navigationTween(), undefined)
  assert.equal(ScrollTrigger.getAll()[0].vars.snap, undefined)
  const transition = planningScrollLayout(height, 3).transitions[0]
  await scroll(transition.start + (transition.end - transition.start) * 0.3)
  assert.equal(progressChanges.at(-1), 0)
  await scroll(transition.start + (transition.end - transition.start) * 0.7)
  assert.equal(progressChanges.at(-1), 1)
})
