import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  addDays, addMonths, clampCalendarMonth, dayKey, MAX_DAY, MIN_DAY,
  monthCells, monthStart, selectRangeDate,
} from './planning-time'
import type { PlanningTimeRange } from './planning-time'

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month, 1))),
)
const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeZone: 'UTC' })
const monthLabel = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function DateRangeCalendar({ value, onChange, onPreviewDayChange, onDaySelect }: {
  value: PlanningTimeRange
  onChange: (value: PlanningTimeRange) => void
  onPreviewDayChange?: (day: string | null) => void
  onDaySelect?: (day: string) => void
}) {
  const [month, setMonth] = useState(() => clampCalendarMonth(monthStart(value.startDate)))
  const [focusedDay, setFocusedDay] = useState(value.startDate)
  const [hoverDay, setHoverDay] = useState<string | null>(null)
  const dayButtons = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef(false)
  const [today] = useState(() => dayKey(new Date()))

  useEffect(() => {
    if (pendingFocus.current) {
      dayButtons.current.get(focusedDay)?.focus()
      pendingFocus.current = false
    }
  }, [focusedDay, month])

  const navigate = (nextMonth: string) => {
    const next = clampCalendarMonth(nextMonth)
    setMonth(next)
    setFocusedDay(next)
    setHoverDay(null)
    onPreviewDayChange?.(null)
  }

  const chooseDay = (day: string) => {
    setFocusedDay(day)
    setHoverDay(null)
    onChange(selectRangeDate(value, day))
    onDaySelect?.(day)
    onPreviewDayChange?.(null)
  }

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    let next: string
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
    switch (event.key) {
      case 'ArrowLeft': next = addDays(day, -1); break
      case 'ArrowRight': next = addDays(day, 1); break
      case 'ArrowUp': next = addDays(day, -7); break
      case 'ArrowDown': next = addDays(day, 7); break
      case 'Home': next = addDays(day, -weekday); break
      case 'End': next = addDays(day, 6 - weekday); break
      case 'PageUp':
      case 'PageDown': {
        const destination = addMonths(monthStart(day), (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1))
        const lastDay = Number(addDays(addMonths(destination, 1), -1).slice(-2))
        next = `${destination.slice(0, 7)}-${String(Math.min(Number(day.slice(-2)), lastDay)).padStart(2, '0')}`
        break
      }
      default: return
    }
    event.preventDefault()
    if (next < MIN_DAY || next > MAX_DAY) return
    const nextMonth = monthStart(next)
    if (nextMonth < month || nextMonth > addMonths(month, 1)) setMonth(clampCalendarMonth(nextMonth))
    pendingFocus.current = true
    setFocusedDay(next)
    if (!value.endDate) setHoverDay(next)
  }

  const rangeEnd = value.endDate ?? hoverDay
  const low = rangeEnd && rangeEnd < value.startDate ? rangeEnd : value.startDate
  const high = rangeEnd && rangeEnd > value.startDate ? rangeEnd : value.startDate

  return (
    <div className="date-range-calendar" onMouseLeave={() => { setHoverDay(null); onPreviewDayChange?.(null) }}>
      <div className="calendar-toolbar">
        <div className="calendar-jump">
          <select aria-label="Calendar month" value={Number(month.slice(5, 7)) - 1}
            onChange={event => navigate(`${month.slice(0, 4)}-${String(Number(event.target.value) + 1).padStart(2, '0')}-01`)}>
            {monthNames.map((name, index) => <option key={name} value={index}>{name}</option>)}
          </select>
          <select aria-label="Calendar year" value={Number(month.slice(0, 4))}
            onChange={event => navigate(`${event.target.value}${month.slice(4)}`)}>
            {Array.from({ length: 688 }, (_, index) => index + 1962).map(year => <option key={year}>{year}</option>)}
          </select>
        </div>
        <div className="calendar-navigation">
          <button type="button" className="today-button" onClick={() => navigate(monthStart(today))}>Today</button>
          <button type="button" className="calendar-arrow" aria-label="Previous month" disabled={month === '1962-01-01'} onClick={() => navigate(addMonths(month, -1))}>‹</button>
          <button type="button" className="calendar-arrow" aria-label="Next month" disabled={month === '2649-11-01'} onClick={() => navigate(addMonths(month, 1))}>›</button>
        </div>
      </div>

      <div className="calendar-months">
        {[month, addMonths(month, 1)].map(visibleMonth => {
          const cells = monthCells(visibleMonth)
          return (
            <div className="calendar-month" key={visibleMonth}>
              <h3 id={`month-${visibleMonth}`} aria-live="polite">{monthLabel.format(new Date(`${visibleMonth}T00:00:00Z`))}</h3>
              <table role="grid" aria-labelledby={`month-${visibleMonth}`} aria-multiselectable="true">
                <thead><tr>{weekdays.map(day => <th key={day} scope="col"><abbr title={day}>{day.slice(0, 2)}</abbr></th>)}</tr></thead>
                <tbody>{Array.from({ length: 6 }, (_, row) => (
                  <tr key={row}>{cells.slice(row * 7, row * 7 + 7).map((day, column) => {
                    if (!day) return <td key={`empty-${column}`} />
                    const selected = day >= low && day <= high
                    const start = day === low
                    const end = day === high
                    const classes = [selected && 'is-selected', selected && start && 'is-start', selected && end && 'is-end', !value.endDate && 'is-preview'].filter(Boolean).join(' ')
                    const label = `${fullDate.format(new Date(`${day}T00:00:00Z`))}${day === value.startDate ? ', start date' : ''}${day === value.endDate ? ', end date' : ''}`
                    return (
                      <td key={day} className={classes} aria-selected={selected}>
                        <button type="button" className="calendar-day" data-day={day}
                          ref={button => { if (button) dayButtons.current.set(day, button); else dayButtons.current.delete(day) }}
                          tabIndex={day === focusedDay ? 0 : -1} aria-label={label} aria-current={day === today ? 'date' : undefined}
                          onClick={() => chooseDay(day)} onMouseEnter={() => { if (!value.endDate) setHoverDay(day); onPreviewDayChange?.(day) }}
                          onMouseLeave={() => onPreviewDayChange?.(null)}
                          onFocus={() => onPreviewDayChange?.(day)} onBlur={() => onPreviewDayChange?.(null)}
                          onKeyDown={event => onDayKeyDown(event, day)}>
                          {Number(day.slice(-2))}
                        </button>
                      </td>
                    )
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
          )
        })}
      </div>
      <p className="calendar-instruction" aria-live="polite">{value.endDate ? 'Select a day to start a new range.' : 'Now select the end date.'}</p>
    </div>
  )
}
