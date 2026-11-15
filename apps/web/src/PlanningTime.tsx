import { useCallback, useEffect, useRef, useState } from 'react'
import DateRangeCalendar from './DateRangeCalendar'
import ClockTimeInput from './ClockTimeInput'
import { defaultTimeRange, parseClockTime, clockText, resolveTimeRange } from './planning-time'
import type { PlanningTimeRange } from './planning-time'

const STORAGE_KEY = 'lunar-lense:planning-time'
const dateLabel = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function initialRange(): PlanningTimeRange {
  try {
    const range = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PlanningTimeRange> | null
    if (range && typeof range.startDate === 'string' && typeof range.endDate === 'string'
      && typeof range.startTime === 'string' && typeof range.endTime === 'string') {
      const candidate = range as PlanningTimeRange
      if (!resolveTimeRange(candidate).error) return candidate
    }
  } catch { /* A blocked or empty session store does not prevent editing. */ }
  return defaultTimeRange(new Date())
}

function displayTime(value: string) {
  const parsed = parseClockTime(value)
  return parsed ? clockText(parsed.hours, parsed.minutes) : 'HH:MM'
}

function durationLabel(minutes: number) {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor(minutes % 1440 / 60)
  const rest = minutes % 60
  return [days && `${days} ${days === 1 ? 'day' : 'days'}`, hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`, rest && `${rest} ${rest === 1 ? 'minute' : 'minutes'}`].filter(Boolean).join(', ')
}

function SectionIcon({ section }: { section: 'dates' | 'times' }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {section === 'dates' ? <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></>
      : <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
  </svg>
}

export default function PlanningTime({ embedded = false, onPreviewTimeChange }: {
  embedded?: boolean
  onPreviewTimeChange?: (timestamp: number) => void
}) {
  const [value, setValue] = useState(initialRange)
  const [selectedDay, setSelectedDay] = useState(() => value.endDate ?? value.startDate)
  const [hoveredDay, setHoveredDay] = useState<string | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const [expanded, setExpanded] = useState<'dates' | 'times'>('dates')
  const heading = useRef<HTMLHeadingElement>(null)
  const resolved = resolveTimeRange(value)

  useEffect(() => { if (!embedded) heading.current?.focus({ preventScroll: true }) }, [embedded])

  useEffect(() => () => { if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current) }, [])

  const queueHoveredDay = useCallback((day: string | null) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      setHoveredDay(day)
    }, 300)
  }, [])

  const clearHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHoveredDay(null)
  }

  const previewDay = hoveredDay ?? selectedDay
  const previewTime = previewDay === value.endDate ? value.endTime : value.startTime
  useEffect(() => {
    const time = parseClockTime(previewTime)
    if (time) onPreviewTimeChange?.(Date.parse(`${previewDay}T${clockText(time.hours, time.minutes)}:00Z`))
  }, [previewDay, previewTime, onPreviewTimeChange])

  useEffect(() => {
    if (!resolveTimeRange(value).value) return
    const next = { ...value, startTime: displayTime(value.startTime), endTime: displayTime(value.endTime) }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* Keep editing when storage is blocked. */ }
  }, [value])

  const Heading = embedded ? 'h2' : 'h1'

  const change = (next: PlanningTimeRange) => {
    setValue(next)
  }

  const summaries = {
    dates: `${dateLabel.format(new Date(`${value.startDate}T00:00:00Z`))} – ${value.endDate ? dateLabel.format(new Date(`${value.endDate}T00:00:00Z`)) : 'Select end date'}`,
    times: `${displayTime(value.startTime)} – ${displayTime(value.endTime)} UTC`,
  }

  return (
    <section className={`planning-page${embedded ? ' planning-embedded' : ''}`}>
      {!embedded && <nav className="planning-nav" aria-label="Planning navigation">
        <a href="#" className="back-home"><span aria-hidden="true">←</span> Home</a>
        <span className="planning-wordmark">Lunar Lense</span>
      </nav>}
      <div className="planning-content">
        <header className="planning-heading">
          <Heading ref={heading} id="time-range-title" tabIndex={-1}>Time range</Heading>
          <p>All dates and times are in UTC.</p>
        </header>

        <div className="time-range-fields">
          <div className="time-range-picker">
            {(['dates', 'times'] as const).map(section => (
              <section key={section} className={`range-section${expanded === section ? ' is-open' : ''}`}>
                <h2 className="range-section-heading">
                  <button type="button" id={`${section}-heading`} className="range-section-toggle"
                    aria-expanded={expanded === section} aria-controls={`${section}-panel`} aria-disabled={expanded === section}
                    onClick={() => { setExpanded(section); clearHover() }}>
                    <SectionIcon section={section} />
                    <span className="range-section-title">{section === 'dates' ? 'Dates' : 'Times'}</span>
                    <span className="range-section-summary">{summaries[section]}</span>
                    <svg className="section-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
                  </button>
                </h2>
                <div id={`${section}-panel`} className="range-section-panel" role="region" aria-labelledby={`${section}-heading`}
                  hidden={expanded !== section} aria-hidden={expanded !== section} inert={expanded !== section}>
                  {section === 'dates'
                    ? <DateRangeCalendar value={value} onChange={change}
                      onDaySelect={day => { clearHover(); setSelectedDay(day) }} onPreviewDayChange={queueHoveredDay} />
                    : <div className="time-clocks">
                      <ClockTimeInput label="Start" value={value.startTime} onChange={startTime => change({ ...value, startTime })} />
                      <ClockTimeInput label="End" value={value.endTime} onChange={endTime => change({ ...value, endTime })} />
                    </div>}
                </div>
              </section>
            ))}
          </div>
          <div className="time-range-status">
            <p className={`range-feedback${resolved.error ? ' is-error' : ''}`} role="status">
              {resolved.error ?? `${durationLabel(resolved.value!.durationMinutes)} selected`}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
