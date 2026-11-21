import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineResponse } from '@lunar-lense/contracts'
import MoonGlobe from './MoonGlobe'
import PlanningTime from './PlanningTime'
import PlanningFlow from './PlanningFlow'
import PlanningLocation from './PlanningLocation'
import PlanningSubmit from './PlanningSubmit'
import type { PlanningTimeRange } from './planning-time'
import { initialLocationDraft, locationDraft, LOCATION_STORAGE_KEY, resolveLocation } from './planning-location'
import type { LunarLocation } from './planning-location'
import { rememberPlan } from './recent-plans'
import type { RecentPlan } from './recent-plans'
import SurfacePreview from './SurfacePreview'
import StarField from './StarField'
import { savedSurfacePlan, createSurfacePlan, SURFACE_PLAN_STORAGE_KEY } from './surface-plan'
import './planning.css'
import './location.css'

function App() {
  const [recentPlans, setRecentPlans] = useState<RecentPlan[]>([])
  const [restoredTime, setRestoredTime] = useState<{ range?: PlanningTimeRange; revision: number }>({ revision: 0 })
  const [surface, setSurface] = useState(() => ({ plan: savedSurfacePlan(), revision: 0 }))
  const openSurface = useCallback((timeline: TimelineResponse) => {
    const plan = createSurfacePlan(timeline)
    setRecentPlans(recent => rememberPlan(recent, timeline))
    try { sessionStorage.setItem(SURFACE_PLAN_STORAGE_KEY, JSON.stringify(plan)) } catch { /* The scene also works without storage. */ }
    setSurface(current => ({ plan, revision: current.revision + 1 }))
  }, [])
  const moonFrameRef = useRef<HTMLDivElement>(null)
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const [timeRange, setTimeRange] = useState<PlanningTimeRange | null>(null)
  const [planningActive, setPlanningActive] = useState(false)
  const [activeStep, setActiveStep] = useState('home')
  const [splitPlanner, setSplitPlanner] = useState(() => window.matchMedia('(max-width: 1000px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)')
    const update = () => setSplitPlanner(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const [siteDraft, setSiteDraft] = useState(initialLocationDraft)
  const site = useMemo(() => resolveLocation(siteDraft).location, [siteDraft])
  const selectSite = useCallback((location: LunarLocation) => setSiteDraft(locationDraft(location)), [])
  const restorePlan = (plan: RecentPlan) => {
    selectSite(plan.location)
    setTimeRange(plan.range)
    setRestoredTime(current => ({ range: plan.range, revision: current.revision + 1 }))
  }
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
      <StarField />

      <main className="home-hero planning-flow-layout" data-active-step={activeStep}>
        <PlanningFlow onProgressChange={updatePlanningProgress} onStepChange={setActiveStep}
          splitPlanner={splitPlanner}
          surfaceAvailable={surface.plan !== null} surfaceRevision={surface.revision} backdrop={
          <div className="moon-backdrop">
            <MoonGlobe live preloadDetail framingRef={moonFrameRef} zoomEnabled={false} previewTime={planningActive ? previewTime : null}
              location={site} selectable={activeStep === (splitPlanner ? 'location' : 'planner')} onLocationChange={selectSite} />
          </div>
        }>
          <section id="home" className="flow-step" aria-labelledby="home-title" tabIndex={-1}>
            <div className="hero-copy">
              <h1 id="home-title" className="hero-brand">
                <svg className="brand-logo" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <circle cx="16" cy="16" r="8" fill="currentColor" />
                  <ellipse cx="16" cy="16" rx="16" ry="6" transform="rotate(-35 16 16)" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span className="brand-name"><span>Lunar</span><span>Lens</span></span>
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
          <section id="planner" className="flow-step flow-step-planner" aria-labelledby="time-range-title" tabIndex={-1}>
            <div className="planner-controls">
              <PlanningTime key={restoredTime.revision} embedded initialValue={restoredTime.range}
                onPreviewTimeChange={setPreviewTime} onRangeChange={setTimeRange} />
            </div>
          </section>
          <section id="location" className="flow-step flow-step-location" aria-labelledby="planner-title" tabIndex={-1}>
            <PlanningLocation value={siteDraft} onChange={setSiteDraft} recentPlans={recentPlans}
              timeRange={timeRange} onRecentSelect={restorePlan}
              heading={splitPlanner ? 'Location' : 'Planner'} />
          </section>
          {surface.plan && <section id="surface" className="flow-step flow-step-surface" aria-label="Moon surface" tabIndex={-1}>
            <SurfacePreview key={surface.revision} plan={surface.plan} active={activeStep === 'surface'} />
          </section>}
          {splitPlanner && <div className="planning-submit" hidden={activeStep !== 'planner'}>
            <a className="planning-submit-button" href="#location">Continue to location <span aria-hidden="true">→</span></a>
          </div>}
          <PlanningSubmit timeRange={timeRange} siteDraft={siteDraft} visible={activeStep === (splitPlanner ? 'location' : 'planner')}
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
