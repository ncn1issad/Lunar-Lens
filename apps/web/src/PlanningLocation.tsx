import { locationDraft, locationLabel, locationPresets, resolveLocation } from './planning-location'
import type { LocationDraft } from './planning-location'

export default function PlanningLocation({ value, onChange }: {
  value: LocationDraft
  onChange: (draft: LocationDraft) => void
}) {
  const { location, error } = resolveLocation(value)
  return (
    <section className="location-panel" aria-labelledby="location-title">
      <header className="planning-heading"><h2 id="location-title">Location</h2><p>Click the Moon or enter coordinates.</p></header>
      <div className="location-picker">
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
        <div className="location-list" role="group" aria-label="Preset lunar locations" tabIndex={0}>
          {locationPresets.map(preset => {
            const selected = location && Math.abs(location.latitude - preset.latitude) < 0.00001 && Math.abs(location.longitude - preset.longitude) < 0.00001
            return <button type="button" key={preset.name} aria-pressed={!!selected} onClick={() => onChange(locationDraft(preset))}>
              <span>{preset.name}<small>{locationLabel(preset)}</small></span>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{selected ? <path d="m4 10 4 4 8-8" /> : <path d="M4 10h12m-5-5 5 5-5 5" />}</svg>
            </button>
          })}
        </div>
      </div>
      <p id="location-feedback" className={`range-feedback location-feedback${error ? ' is-error' : ''}`} role="status">
        {error ?? `${locationLabel(location!)} selected`}
      </p>
    </section>
  )
}
