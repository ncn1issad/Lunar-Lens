import { useEffect, useId, useRef, useState } from 'react'
import { locationDraft, locationLabel, locationPresets, resolveLocation, sameLocation } from './planning-location'
import type { LocationDraft } from './planning-location'
import type { PlanningTimeRange } from './planning-time'
import { matchesRecentPlan } from './recent-plans'
import type { RecentPlan } from './recent-plans'

const recentDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
})

export default function PlanningLocation({ value, onChange, recentPlans = [], timeRange = null, onRecentSelect, heading = 'Planner' }: {
  value: LocationDraft
  onChange: (draft: LocationDraft) => void
  recentPlans?: RecentPlan[]
  timeRange?: PlanningTimeRange | null
  onRecentSelect?: (plan: RecentPlan) => void
  heading?: string
}) {
  const { location, error } = resolveLocation(value)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const resultsId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const regions = locationPresets.filter(site => site.name.toLowerCase().includes(query.trim().toLowerCase()))
  useEffect(() => {
    if (searchOpen && activeIndex >= 0) document.getElementById(`${resultsId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, searchOpen, resultsId])
  const selectRegion = (site: typeof locationPresets[number]) => {
    onChange(locationDraft(site))
    setQuery('')
    setSearchOpen(false)
    setActiveIndex(-1)
  }
  const locationButton = (plan: RecentPlan) => {
    const site = plan.location
    const selected = location !== null && matchesRecentPlan(plan, location, timeRange)
    const [latitude, longitude] = locationLabel(site).split(' / ')
    const name = locationPresets.find(preset => sameLocation(preset, site))?.name ?? 'Custom location'
    const start = recentDate.format(new Date(`${plan.range.startDate}T${plan.range.startTime}:00Z`))
    const end = recentDate.format(new Date(`${plan.range.endDate}T${plan.range.endTime}:00Z`))
    return <button type="button" key={plan.id} aria-pressed={selected} onClick={() => onRecentSelect?.(plan)}>
      <svg className="location-recent-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6m3-4v5l3 2" /></svg>
      <span>{name}<small><span>{latitude}</span>{' '}<span>/ {longitude}</span></small>
        <small className="location-recent-dates"><span>{start}</span><span>to {end} UTC</span></small>
        <span className="location-recent-timeline" style={{ background: plan.visibility }} aria-hidden="true" />
      </span>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{selected ? <path d="m4 10 4 4 8-8" /> : <path d="M4 10h12m-5-5 5 5-5 5" />}</svg>
    </button>
  }
  return (
    <section className="location-panel" aria-labelledby="planner-title">
      <header className="planning-heading"><h2 id="planner-title">{heading}</h2><p>Click the Moon or enter coordinates.</p></header>
      <div className="location-picker">
        <h3 className="location-section-heading">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>
          Coordinates
        </h3>
        <div className="location-coordinates">
          <label htmlFor="site-latitude">Latitude <span>North +</span>
            <input id="site-latitude" type="number" step="any" min="-90" max="90" value={value.latitude}
              aria-describedby="location-feedback" onChange={event => onChange({ ...value, latitude: event.target.value })} />
          </label>
          <label htmlFor="site-longitude">Longitude <span>East +</span>
            <input id="site-longitude" type="number" step="any" min="-180" max="360" value={value.longitude}
              aria-describedby="location-feedback" onChange={event => onChange({ ...value, longitude: event.target.value })} />
          </label>
        </div>
        <section className="location-regions" aria-labelledby="location-regions-title"
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) { setSearchOpen(false); setActiveIndex(-1) }
          }}>
          <div className="location-regions-toolbar">
            <h3 id="location-regions-title">Presets</h3>
            <div className="location-search">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
              <input ref={searchRef} type="text" role="combobox" aria-label="Search lunar presets" placeholder="Search presets"
                autoComplete="off" aria-autocomplete="list" aria-expanded={searchOpen} aria-controls={resultsId}
                aria-activedescendant={searchOpen && activeIndex >= 0 ? `${resultsId}-${activeIndex}` : undefined}
                value={query} onFocus={() => setSearchOpen(true)} onClick={() => setSearchOpen(true)} onChange={event => {
                  setQuery(event.target.value); setSearchOpen(true); setActiveIndex(-1)
                }} onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false); setActiveIndex(-1) }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    setSearchOpen(true)
                    const next = regions.length ? (activeIndex + (event.key === 'ArrowDown' ? 1 : activeIndex < 0 ? 0 : -1) + regions.length) % regions.length : -1
                    setActiveIndex(next)
                  }
                  if (event.key === 'Enter' && searchOpen && regions.length) {
                    event.preventDefault(); selectRegion(regions[activeIndex >= 0 ? activeIndex : 0])
                  }
                }} />
              {query && <button type="button" className="location-search-clear" aria-label="Clear preset search" onClick={() => {
                setQuery(''); setActiveIndex(-1); setSearchOpen(true); searchRef.current?.focus()
              }}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>}
            </div>
          </div>
          {searchOpen && <div className="location-region-results">
            <div id={resultsId} role="listbox" aria-label="Lunar presets">
              {regions.map((site, index) => <div key={site.name} id={`${resultsId}-${index}`} role="option"
                aria-selected={location !== null && sameLocation(location, site)} className={`location-region-option${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={event => event.preventDefault()} onClick={() => selectRegion(site)}>
                <span>{site.name}<small>{locationLabel(site)}</small></span>
                {location !== null && sameLocation(location, site) && <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
              </div>)}
            </div>
            {!regions.length && <p className="location-empty" role="status">No presets found. Try another name or enter coordinates above.</p>}
          </div>}
        </section>
        <section className="location-recents" aria-labelledby="location-recent-title">
          <h3 id="location-recent-title">Recents</h3>
          <div className="location-list" role="group" aria-label="Recent plans" tabIndex={recentPlans.length ? 0 : undefined}>
            {recentPlans.length ? recentPlans.map(plan => locationButton(plan))
              : <p className="location-empty">Your locations and time ranges appear here after you submit.</p>}
          </div>
        </section>
      </div>
      <p id="location-feedback" className={`range-feedback location-feedback${error ? ' is-error' : ''}`} role="status">
        {error ?? `${locationLabel(location!)} selected`}
      </p>
    </section>
  )
}
