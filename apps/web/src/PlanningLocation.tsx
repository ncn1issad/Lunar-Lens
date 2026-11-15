import { locationDraft, locationLabel, locationPresets, resolveLocation, sameLocation } from './planning-location'
import type { LocationDraft, LunarLocation } from './planning-location'

export default function PlanningLocation({ value, onChange, recentLocations = [] }: {
  value: LocationDraft
  onChange: (draft: LocationDraft) => void
  recentLocations?: LunarLocation[]
}) {
  const { location, error } = resolveLocation(value)
  const locationButton = (site: LunarLocation, name: string) => {
    const selected = location !== null && sameLocation(location, site)
    const [latitude, longitude] = locationLabel(site).split(' / ')
    return <button type="button" key={`${site.latitude},${site.longitude}`} aria-pressed={selected} onClick={() => onChange(locationDraft(site))}>
      <span>{name}<small><span>{latitude}</span>{' '}<span>/ {longitude}</span></small></span>
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{selected ? <path d="m4 10 4 4 8-8" /> : <path d="M4 10h12m-5-5 5 5-5 5" />}</svg>
    </button>
  }
  return (
    <section className="location-panel" aria-labelledby="planner-title">
      <header className="planning-heading"><h2 id="planner-title">Planner</h2><p>Click the Moon or enter coordinates.</p></header>
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
        <div className="location-columns">
          <section className="location-column" aria-labelledby="location-presets-title">
            <h3 id="location-presets-title">Presets</h3>
            <div className="location-list" role="group" aria-label="Preset lunar locations" tabIndex={0}>
              {locationPresets.map(preset => locationButton(preset, preset.name))}
            </div>
          </section>
          <section className="location-column" aria-labelledby="location-recent-title">
            <h3 id="location-recent-title">Recent</h3>
            <div className="location-list" role="group" aria-label="Recent custom locations" tabIndex={recentLocations.length ? 0 : undefined}>
              {recentLocations.length ? recentLocations.map(site => locationButton(site, 'Custom location'))
                : <p className="location-empty">Your custom locations appear here after you submit.</p>}
            </div>
          </section>
        </div>
      </div>
      <p id="location-feedback" className={`range-feedback location-feedback${error ? ' is-error' : ''}`} role="status">
        {error ?? `${locationLabel(location!)} selected`}
      </p>
    </section>
  )
}
