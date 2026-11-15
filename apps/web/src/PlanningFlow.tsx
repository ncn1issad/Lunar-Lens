import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'

const steps = [{ id: 'home', label: 'Home' }, { id: 'plan', label: 'Time' }, { id: 'location', label: 'Location' }, { id: 'surface', label: 'Surface' }] as const
type StepId = typeof steps[number]['id']

function stepTop(viewport: HTMLElement, section: HTMLElement) {
  const sections = [...viewport.querySelectorAll<HTMLElement>('.flow-step')]
  return sections.slice(0, sections.indexOf(section)).reduce((top, step) => top + step.offsetHeight, 0)
}

export default function PlanningFlow({ children, backdrop, onProgressChange, onStepChange }: {
  children: ReactNode
  backdrop?: ReactNode
  onProgressChange?: (progress: number, locationProgress: number) => void
  onStepChange?: (step: StepId) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<StepId>('home')

  const goTo = useCallback((id: StepId, behavior: ScrollBehavior = 'smooth', focus = false) => {
    const viewport = viewportRef.current
    const section = viewport?.querySelector<HTMLElement>(`#${id}`)
    if (!viewport || !section) return
    const top = stepTop(viewport, section) - Math.max(0, (viewport.clientHeight - section.offsetHeight) / 2)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    viewport.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'instant' : behavior })
    setActive(id)
    if (focus) section.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const sections = [...viewport.querySelectorAll<HTMLElement>('.flow-step')]
    const timePicker = viewport.querySelector<HTMLElement>('.time-range-picker')
    let frame: number | null = null

    const updateActive = () => {
      frame = null
      const firstInput = sections[1]
      const inputTop = firstInput ? stepTop(viewport, firstInput) - Math.max(0, (viewport.clientHeight - firstInput.offsetHeight) / 2) : 0
      const location = sections.find(section => section.id === 'location')
      const locationTop = location ? stepTop(viewport, location) : inputTop
      const locationProgress = locationTop > inputTop ? Math.min(1, Math.max(0, (viewport.scrollTop - inputTop) / (locationTop - inputTop))) : 0
      onProgressChange?.(inputTop > 0 ? Math.min(1, Math.max(0, viewport.scrollTop / inputTop)) : 0, locationProgress)
      const bounds = viewport.getBoundingClientRect()
      const center = bounds.top + bounds.height / 2
      const current = sections.findLast(section => {
        const rect = section.getBoundingClientRect()
        return rect.top <= center && rect.bottom > center
      })
      if (current && steps.some(step => step.id === current.id)) setActive(current.id as StepId)
    }
    const onScroll = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateActive)
    }
    const onResize = () => {
      const column = viewport.parentElement?.getBoundingClientRect()
      if (column?.width) {
        viewport.style.setProperty('--flow-column-left', `${column.left}px`)
        viewport.style.setProperty('--flow-column-width', `${column.width}px`)
      }
      const pickerHeight = timePicker?.getBoundingClientRect().height
      if (pickerHeight) viewport.style.setProperty('--time-picker-height', `${pickerHeight}px`)
      for (const section of sections) {
        // Tall inputs remain freely scrollable instead of snapping past their controls.
        section.dataset.overflow = String(section.offsetHeight > viewport.clientHeight + 1)
      }
      onScroll()
    }
    const onLocationChange = () => {
      const id = window.location.hash.slice(1)
      const step = steps.find(step => step.id === id) ?? steps[0]
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

    const observer = new ResizeObserver(onResize)
    observer.observe(viewport)
    if (viewport.parentElement) observer.observe(viewport.parentElement)
    if (timePicker) observer.observe(timePicker)
    for (const section of sections) observer.observe(section)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    viewport.addEventListener('click', onSectionLink)
    window.addEventListener('hashchange', onLocationChange)
    window.addEventListener('popstate', onLocationChange)
    onResize()
    onLocationChange()

    return () => {
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', onScroll)
      viewport.removeEventListener('click', onSectionLink)
      window.removeEventListener('hashchange', onLocationChange)
      window.removeEventListener('popstate', onLocationChange)
    }
  }, [goTo, onProgressChange])

  useEffect(() => {
    document.title = active === 'surface' ? 'Moon surface | Lunar Lense'
      : active === 'location' ? 'Location | Lunar Lense' : active === 'plan' ? 'Time range | Lunar Lense' : 'Lunar Lense'
    onStepChange?.(active)
  }, [active, onStepChange])

  const navigate = (event: MouseEvent<HTMLAnchorElement>, id: StepId) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.history.pushState(null, '', `#${id}`)
    goTo(id, 'smooth', true)
  }

  return (
    <div className="flow-column">
      <nav className="flow-navigation" aria-label="Planning sections">
        {steps.map(step => <a key={step.id} href={`#${step.id}`} aria-current={active === step.id ? 'step' : undefined}
          onClick={event => navigate(event, step.id)}>{step.label}</a>)}
      </nav>
      <div ref={viewportRef} className="flow-viewport" role="region" aria-label="Planning inputs" tabIndex={0}>
        {backdrop}
        {children}
      </div>
    </div>
  )
}
