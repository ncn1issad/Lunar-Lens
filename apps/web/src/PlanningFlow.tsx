import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { planningScrollLayout, resizePlanningScroll, SECTION_LINK_SECONDS, settlePlanningScroll } from './planning-scroll'

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin)

const allSteps = [{ id: 'home', label: 'Home' }, { id: 'planner', label: 'Planner' }, { id: 'location', label: 'Location' }, { id: 'surface', label: 'Surface' }] as const
type StepId = typeof allSteps[number]['id']
const clamp = (value: number) => Math.max(0, Math.min(1, value))

export default function PlanningFlow({ children, backdrop, onProgressChange, onStepChange, splitPlanner = false, surfaceAvailable = false, surfaceRevision = 0 }: {
  children: ReactNode
  backdrop?: ReactNode
  onProgressChange?: (progress: number) => void
  onStepChange?: (step: StepId) => void
  splitPlanner?: boolean
  surfaceAvailable?: boolean
  surfaceRevision?: number
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const callbacksRef = useRef({ onProgressChange, onStepChange })
  const initializedRef = useRef(false)
  const targetRef = useRef<(id: StepId, behavior: ScrollBehavior, focus: boolean) => void>(() => {})
  const pendingFocusRef = useRef<StepId | null>(null)
  const [active, setActive] = useState<StepId>('home')
  const activeRef = useRef<StepId>('home')
  const previousSplitRef = useRef(splitPlanner)
  const steps = useMemo(() => allSteps
    .filter(step => (step.id !== 'surface' || surfaceAvailable) && (step.id !== 'location' || splitPlanner))
    .map(step => ({ ...step, label: step.id === 'planner' && splitPlanner ? 'Time' : step.label })), [surfaceAvailable, splitPlanner])
  useLayoutEffect(() => { callbacksRef.current = { onProgressChange, onStepChange } })
  const goTo = useCallback((id: StepId, behavior: ScrollBehavior = 'smooth', focus = false) => {
    targetRef.current(id, behavior, focus)
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    const sections = [...track.querySelectorAll<HTMLElement>('.flow-step')]
    const previousStep = activeRef.current
    const splitChanged = previousSplitRef.current !== splitPlanner
    previousSplitRef.current = splitPlanner
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let layout = planningScrollLayout(viewport.clientHeight, steps.length)
    let timeline: gsap.core.Timeline
    let trigger: ScrollTrigger
    let lastActive = ''
    let resizeFrame = 0
    let previousHeight = viewport.clientHeight
    let refreshing = false
    let navigationTween: gsap.core.Tween | null = null
    const playhead = { phase: 0 }
    const stopNavigation = () => {
      navigationTween?.kill()
      navigationTween = null
      pendingFocusRef.current = null
    }

    const render = () => {
      // ScrollTrigger briefly rewinds animations while it measures. Keep focus
      // and accessibility state on the visible page throughout that measurement.
      if (refreshing) return
      const phase = motionQuery.matches ? Math.round(playhead.phase) : playhead.phase
      const planning = clamp(phase)
      const current = steps[Math.min(steps.length - 1, Math.round(phase))].id
      callbacksRef.current.onProgressChange?.(planning)
      for (const section of sections) {
        let opacity = 0
        let x = 0
        let y = 0
        if (section.id === 'home') { opacity = 1 - planning; y = -48 * planning }
        const id = section.id === 'location' && !splitPlanner ? 'planner' : section.id
        const index = steps.findIndex(step => step.id === id)
        if (index > 0) {
          const entering = clamp(phase - index + 1)
          const leaving = clamp(phase - index)
          opacity = entering * (1 - leaving)
          x = id === 'surface' ? 0 : 64 * (1 - entering)
          y = id === 'surface' ? 48 * (1 - entering) : -32 * leaving
        }
        section.style.opacity = String(opacity)
        section.style.visibility = opacity > 0.001 ? 'visible' : 'hidden'
        section.style.transform = `translate3d(${x}px, ${y}px, 0)`
        // Mounted inputs retain their values, but offscreen controls cannot take focus.
        const interactive = opacity > 0.5
        section.inert = !interactive
        section.setAttribute('aria-hidden', String(!interactive))
      }
      if (current !== lastActive) {
        lastActive = current
        activeRef.current = current
        setActive(current)
      }
      const pending = pendingFocusRef.current
      const section = sections.find(section => section.id === pending)
      if (section && !section.inert && current === pending) {
        section.focus({ preventScroll: true })
        pendingFocusRef.current = null
      }
    }

    const build = () => {
      trigger?.kill(false)
      timeline?.kill()
      layout = planningScrollLayout(viewport.clientHeight, steps.length)
      track.style.height = `${viewport.clientHeight + layout.distance}px`
      playhead.phase = 0
      timeline = gsap.timeline({ paused: true, onUpdate: render })
      // Explicit gaps between these tweens are the page holds.
      for (const [index, transition] of layout.transitions.entries()) {
        timeline.to(playhead, { phase: index + 1, duration: transition.end - transition.start, ease: 'power1.inOut' }, transition.start)
      }
      timeline.to({}, { duration: layout.distance }, 0)
      trigger = ScrollTrigger.create({
        trigger: track,
        scroller: viewport,
        start: 'top top',
        end: () => layout.distance,
        animation: timeline,
        scrub: true,
        onRefreshInit: () => { refreshing = true },
        onRefresh: () => { refreshing = false; render() },
        snap: motionQuery.matches ? undefined : {
          snapTo: value => navigationTween ? value : settlePlanningScroll(value * layout.distance, layout) / layout.distance,
          inertia: false,
          directional: false,
          delay: 0.18,
          duration: { min: 0.35, max: 0.65 },
        },
      })
      trigger.refresh()
      // Restore the exact scene immediately, including when Surface is added.
      timeline.time(Math.min(viewport.scrollTop, layout.distance))
      render()
    }

    targetRef.current = (id, behavior, focus) => {
      const index = steps.findIndex(step => step.id === id)
      if (index < 0) return
      stopNavigation()
      pendingFocusRef.current = focus ? id : null
      const snapTween = trigger.getTween(true)
      if (snapTween) snapTween.kill()
      const top = layout.targets[index]
      if (behavior === 'smooth' && !motionQuery.matches && Math.abs(top - viewport.scrollTop) > 1) {
        navigationTween = gsap.to(viewport, {
          scrollTo: { y: top, autoKill: true, onAutoKill: stopNavigation },
          duration: SECTION_LINK_SECONDS,
          ease: 'sine.inOut',
          onComplete: () => {
            navigationTween = null
            // Preserve the destination if the layout changes before the next scroll event.
            trigger.update()
            timeline.time(Math.min(viewport.scrollTop, layout.distance))
            render()
          },
        })
        return
      }
      viewport.scrollTo({ top, behavior: 'instant' })
      trigger.update()
      // Instant navigation and browser back/forward need no animation frame.
      timeline.time(Math.min(viewport.scrollTop, layout.distance))
      render()
    }

    const measure = () => {
      const column = viewport.parentElement?.getBoundingClientRect()
      if (column?.width) {
        viewport.style.setProperty('--flow-column-left', `${column.left}px`)
        viewport.style.setProperty('--flow-column-width', `${column.width}px`)
      }
      viewport.style.setProperty('--flow-scrollbar-width', `${Math.max(0, viewport.offsetWidth - viewport.clientWidth)}px`)
    }
    const onResize = () => {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        measure()
        if (viewport.clientHeight !== previousHeight) {
          stopNavigation()
          // Keep the same place in the story after rotating/resizing the screen.
          const top = resizePlanningScroll(viewport.scrollTop, layout, planningScrollLayout(viewport.clientHeight, steps.length))
          previousHeight = viewport.clientHeight
          build()
          viewport.scrollTo({ top, behavior: 'instant' })
          trigger.update()
          timeline.time(viewport.scrollTop)
        }
        render()
      })
    }
    const onPreferenceChange = () => { stopNavigation(); build(); render() }
    const onLocationChange = () => {
      const hash = window.location.hash.slice(1)
      const id = hash === 'plan' || (hash === 'location' && !splitPlanner) ? 'planner' : hash
      const step = steps.find(step => step.id === id) ?? steps[0]
      if (id !== hash) window.history.replaceState(null, '', `#${id}`)
      goTo(step.id, 'instant')
    }
    const onSectionLink = (event: globalThis.MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      const step = steps.find(step => `#${step.id}` === link?.getAttribute('href'))
      if (!step || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      window.history.pushState(null, '', `#${step.id}`)
      goTo(step.id, 'smooth', true)
    }

    measure()
    build()
    if (splitChanged) {
      const id = previousStep === 'location' && !splitPlanner ? 'planner' : previousStep
      goTo(id, 'instant')
      if (window.location.hash === '#location' && !splitPlanner) window.history.replaceState(null, '', '#planner')
    }
    const observer = new ResizeObserver(onResize)
    observer.observe(viewport)
    if (viewport.parentElement) observer.observe(viewport.parentElement)
    viewport.addEventListener('click', onSectionLink)
    window.addEventListener('hashchange', onLocationChange)
    window.addEventListener('popstate', onLocationChange)
    motionQuery.addEventListener('change', onPreferenceChange)
    if (!initializedRef.current) {
      initializedRef.current = true
      onLocationChange()
    }

    return () => {
      stopNavigation()
      observer.disconnect()
      cancelAnimationFrame(resizeFrame)
      trigger.kill(false)
      timeline.kill()
      viewport.removeEventListener('click', onSectionLink)
      window.removeEventListener('hashchange', onLocationChange)
      window.removeEventListener('popstate', onLocationChange)
      motionQuery.removeEventListener('change', onPreferenceChange)
    }
  }, [goTo, steps, splitPlanner])

  useEffect(() => {
    if (!surfaceAvailable || surfaceRevision === 0) return
    window.history.pushState(null, '', '#surface')
    goTo('surface', 'smooth', true)
  }, [goTo, surfaceAvailable, surfaceRevision])

  useEffect(() => {
    document.title = active === 'surface' ? 'Moon surface | Lunar Lens'
      : active === 'location' ? 'Location | Lunar Lens'
      : active === 'planner' ? `${splitPlanner ? 'Time' : 'Planner'} | Lunar Lens` : 'Lunar Lens'
    callbacksRef.current.onStepChange?.(active)
  }, [active, splitPlanner])

  const navigate = (event: MouseEvent<HTMLAnchorElement>, id: StepId) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.history.pushState(null, '', `#${id}`)
    goTo(id, 'smooth', true)
  }

  return (
    <div className="flow-column">
      <nav className="flow-navigation" aria-label="Planning sections" hidden={active === 'surface'}>
        {steps.map(step => <a key={step.id} href={`#${step.id}`} aria-current={active === step.id ? 'step' : undefined}
          onClick={event => navigate(event, step.id)}>{step.label}</a>)}
      </nav>
      <div ref={viewportRef} className="flow-viewport" role="region" aria-label="Planning inputs" tabIndex={0}>
        <div ref={trackRef} className="flow-track">
          <div className="flow-scene">
            {backdrop}
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
