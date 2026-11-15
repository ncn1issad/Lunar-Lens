import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineResponse } from '@lunar-lense/contracts'
import MoonGlobe from './MoonGlobe'
import PlanningTime from './PlanningTime'
import PlanningFlow from './PlanningFlow'
import PlanningLocation from './PlanningLocation'
import PlanningSubmit from './PlanningSubmit'
import type { PlanningTimeRange } from './planning-time'
import { initialLocationDraft, locationDraft, LOCATION_STORAGE_KEY, rememberCustomLocation, resolveLocation } from './planning-location'
import type { LunarLocation } from './planning-location'
import SurfacePreview from './SurfacePreview'
import { savedSurfacePlan, createSurfacePlan, SURFACE_PLAN_STORAGE_KEY } from './surface-plan'
import './planning.css'
import './location.css'

// Fixed positions keep the star field still across renders and page reloads.
const stars = Array.from({ length: 95 }, (_, index) => {
  const seed = index + 1
  const random = (offset: number) => {
    const value = Math.sin(seed * 127.1 + offset * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  return {
    x: random(1) * 1600,
    y: random(2) * 1000,
    radius: 0.5 + random(3) * 0.9,
    opacity: 0.15 + random(4) * 0.5,
  }
})

function App() {
  const [recentLocations, setRecentLocations] = useState<LunarLocation[]>([])
  const [surface, setSurface] = useState(() => ({ plan: savedSurfacePlan(), revision: 0 }))
  const openSurface = useCallback((timeline: TimelineResponse) => {
    const plan = createSurfacePlan(timeline)
    setRecentLocations(recent => rememberCustomLocation(recent, {
      latitude: timeline.observer.latitudeDeg, longitude: timeline.observer.longitudeDeg,
    }))
    try { sessionStorage.setItem(SURFACE_PLAN_STORAGE_KEY, JSON.stringify(plan)) } catch { /* The scene also works without storage. */ }
    setSurface(current => ({ plan, revision: current.revision + 1 }))
  }, [])
  const moonFrameRef = useRef<HTMLDivElement>(null)
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [timeRange, setTimeRange] = useState<PlanningTimeRange | null>(null)
  const [planningActive, setPlanningActive] = useState(false)
  const [activeStep, setActiveStep] = useState('home')
  const [siteDraft, setSiteDraft] = useState(initialLocationDraft)
  const site = useMemo(() => resolveLocation(siteDraft).location, [siteDraft])
  const selectSite = useCallback((location: LunarLocation) => setSiteDraft(locationDraft(location)), [])
  useEffect(() => {
    if (site) {
      try { sessionStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(siteDraft)) } catch { /* Editing works without storage. */ }
    }
  }, [site, siteDraft])
  const updatePlanningProgress = useCallback((progress: number) => {
    if (moonFrameRef.current) {
      moonFrameRef.current.dataset.plannerProgress = String(progress)
    }
    setPlanningActive(progress > 0)
  }, [])

  return (
    <div className="home-page with-planning-flow" data-active-step={activeStep}>
      <svg className="star-field" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {stars.map((star, index) => (
          <circle key={index} cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} />
        ))}
      </svg>

      <main className="home-hero planning-flow-layout" data-active-step={activeStep}>
        <PlanningFlow onProgressChange={updatePlanningProgress} onStepChange={setActiveStep}
          surfaceAvailable={surface.plan !== null} surfaceRevision={surface.revision} backdrop={
          <div className="moon-backdrop">
            <MoonGlobe live preloadDetail framingRef={moonFrameRef} zoomEnabled={false} previewTime={planningActive ? previewTime : null}
              location={site} selectable={activeStep === 'planner'} onLocationChange={selectSite} />
          </div>
        }>
          <section id="home" className="flow-step" aria-labelledby="home-title" tabIndex={-1}>
            <div className="hero-copy">
              <h1 id="home-title" className="hero-brand">
                <svg className="brand-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <circle cx="16" cy="16" r="8" fill="currentColor" />
                  <ellipse cx="16" cy="16" rx="16" ry="6" transform="rotate(-35 16 16)" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span className="brand-name"><span>Lunar</span><span>Lense</span></span>
              </h1>
              <p>Plan around communication windows and solar power availability at your lunar site.</p>
              <a className="start-planning" href="#planner">
                Start planning
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          </section>
          <section id="planner" className="flow-step flow-step-planner" aria-labelledby="planner-title" tabIndex={-1}>
            <div className="planner-controls">
              <PlanningTime embedded onPreviewTimeChange={setPreviewTime} onRangeChange={setTimeRange} />
              <PlanningLocation value={siteDraft} onChange={setSiteDraft} recentLocations={recentLocations} />
            </div>
          </section>
          {surface.plan && <section id="surface" className="flow-step flow-step-surface" aria-label="Moon surface" tabIndex={-1}>
            <SurfacePreview key={surface.revision} plan={surface.plan} active={activeStep === 'surface'} />
          </section>}
          <PlanningSubmit timeRange={timeRange} siteDraft={siteDraft} visible={activeStep === 'planner'}
            onSuccess={openSurface} />
        </PlanningFlow>
        <div ref={moonFrameRef} className="hero-moon" aria-hidden="true" />
      </main>

      <footer className="site-footer">
        <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">Moon imagery by NASA / LROC</a>
      </footer>
    </div>
  )
}

export default App
