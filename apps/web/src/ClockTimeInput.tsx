import { useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { clockText, clockValueAtPoint, parseClockTime, setClockPeriod, setClockUnit } from './planning-time'

export default function ClockTimeInput({ label, value, onChange }: {
  label: 'Start' | 'End'
  value: string
  onChange: (value: string) => void
}) {
  const [unit, setUnit] = useState<'hours' | 'minutes'>('hours')
  const time = parseClockTime(value) ?? { hours: 0, minutes: 0 }
  const validText = clockText(time.hours, time.minutes)
  const hours = time.hours % 12 || 12
  const period = time.hours >= 12 ? 'PM' : 'AM'
  const activeValue = unit === 'hours' ? hours : time.minutes
  const angle = (unit === 'hours' ? hours * 30 : time.minutes * 6) * Math.PI / 180
  const x = 120 + 76 * Math.sin(angle)
  const y = 120 - 76 * Math.cos(angle)

  const selectPoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const selected = clockValueAtPoint(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, unit)
    onChange(setClockUnit(validText, unit, selected))
  }
  const onClockKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const max = unit === 'hours' ? 12 : 60
    const min = unit === 'hours' ? 1 : 0
    let next: number
    switch (event.key) {
      case 'ArrowUp': case 'ArrowRight': next = activeValue + 1; break
      case 'ArrowDown': case 'ArrowLeft': next = activeValue - 1; break
      case 'PageUp': next = activeValue + 5; break
      case 'PageDown': next = activeValue - 5; break
      case 'Home': next = min; break
      case 'End': next = unit === 'hours' ? 12 : 59; break
      default: return
    }
    event.preventDefault()
    next = ((next - min) % max + max) % max + min
    onChange(setClockUnit(validText, unit, next))
  }

  return (
    <div className="clock-input">
      <h3>{label}</h3>
      <div className="clock-digital" role="group" aria-label={`${label} clock controls`}>
        <button type="button" aria-label={`Edit ${label.toLowerCase()} hours`} aria-pressed={unit === 'hours'} onClick={() => setUnit('hours')}>{String(hours).padStart(2, '0')}</button>
        <span aria-hidden="true">:</span>
        <button type="button" aria-label={`Edit ${label.toLowerCase()} minutes`} aria-pressed={unit === 'minutes'} onClick={() => setUnit('minutes')}>{String(time.minutes).padStart(2, '0')}</button>
      </div>
      <div className="clock-dial" role="slider" tabIndex={0}
        aria-label={`${label} ${unit}`} aria-valuemin={unit === 'hours' ? 1 : 0} aria-valuemax={unit === 'hours' ? 12 : 59}
        aria-valuenow={activeValue} aria-valuetext={`${activeValue} ${unit}${unit === 'hours' ? ` ${period}` : ''}`}
        onKeyDown={onClockKeyDown}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); selectPoint(event) }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) selectPoint(event) }}
        onPointerUp={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.currentTarget.releasePointerCapture(event.pointerId); if (unit === 'hours') setUnit('minutes') }}>
        <svg viewBox="0 0 240 240" aria-hidden="true">
          {Array.from({ length: 60 }, (_, index) => {
            const radians = index * Math.PI / 30
            const inner = index % 5 === 0 ? 109 : 113
            return <line key={index} x1={120 + inner * Math.sin(radians)} y1={120 - inner * Math.cos(radians)} x2={120 + 116 * Math.sin(radians)} y2={120 - 116 * Math.cos(radians)} className="clock-tick" />
          })}
          <line x1="120" y1="120" x2={x} y2={y} className="clock-hand" />
          <circle cx={x} cy={y} r="17" className="clock-hand-tip" />
          <circle cx="120" cy="120" r="4" className="clock-hand-tip" />
        </svg>
        {Array.from({ length: 12 }, (_, index) => {
          const number = unit === 'hours' ? index || 12 : index * 5
          const radians = index * Math.PI / 6
          return <span key={index} className={`clock-number${number === activeValue ? ' is-active' : ''}`} aria-hidden="true"
            style={{ left: `${50 + 31.67 * Math.sin(radians)}%`, top: `${50 - 31.67 * Math.cos(radians)}%` }}>{unit === 'minutes' ? String(number).padStart(2, '0') : number}</span>
        })}
      </div>
      <div className="period-selector" role="group" aria-label={`${label} AM or PM`}>
        {(['AM', 'PM'] as const).map(option => <button key={option} type="button" aria-pressed={period === option}
          aria-label={`${label} ${option}`} onClick={() => onChange(setClockPeriod(validText, option))}>{option}</button>)}
      </div>
    </div>
  )
}
