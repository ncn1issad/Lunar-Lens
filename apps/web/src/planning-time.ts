export const DAY_MS = 86_400_000
export const MIN_DAY = '1962-01-01'
export const MAX_DAY = '2649-12-31'

export interface PlanningTimeRange {
  startDate: string
  endDate: string | null
  startTime: string
  endTime: string
}

export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function addDays(day: string, count: number) {
  return dayKey(new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS))
}

export function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`
}

export function addMonths(month: string, count: number) {
  const date = new Date(`${month}T00:00:00Z`)
  return dayKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1)))
}

export function clampCalendarMonth(month: string) {
  return month < '1962-01-01' ? '1962-01-01' : month > '2649-11-01' ? '2649-11-01' : month
}

export function monthCells(month: string): (string | null)[] {
  const first = new Date(`${month}T00:00:00Z`)
  const offset = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1
    return day < 1 || day > days ? null : `${month.slice(0, 7)}-${String(day).padStart(2, '0')}`
  })
}

export function selectRangeDate(range: PlanningTimeRange, day: string): PlanningTimeRange {
  if (range.endDate !== null) return { ...range, startDate: day, endDate: null }
  return day < range.startDate
    ? { ...range, startDate: day, endDate: range.startDate }
    : { ...range, endDate: day }
}

export function parseClockTime(value: string) {
  const match = /^(?:(\d{1,2}):(\d{2})|(\d{2})(\d{2}))$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1] ?? match[3])
  const minutes = Number(match[2] ?? match[4])
  return hours < 24 && minutes < 60 ? { hours, minutes } : null
}

export function clockText(hours: number, minutes: number) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function setClockPeriod(value: string, period: 'AM' | 'PM') {
  const time = parseClockTime(value)
  return time ? clockText(time.hours % 12 + (period === 'PM' ? 12 : 0), time.minutes) : value
}

export function setClockUnit(value: string, unit: 'hours' | 'minutes', selected: number) {
  const time = parseClockTime(value)
  if (!time) return value
  return unit === 'hours'
    ? clockText(selected % 12 + (time.hours >= 12 ? 12 : 0), time.minutes)
    : clockText(time.hours, selected)
}

export function clockValueAtPoint(x: number, y: number, unit: 'hours' | 'minutes') {
  const fraction = ((Math.atan2(x, -y) / (2 * Math.PI)) + 1) % 1
  const divisions = unit === 'hours' ? 12 : 60
  const value = Math.round(fraction * divisions) % divisions
  return unit === 'hours' ? value || 12 : value
}

export function defaultTimeRange(now: Date): PlanningTimeRange {
  const tomorrow = new Date(now.getTime() + DAY_MS)
  return {
    startDate: dayKey(now), endDate: dayKey(tomorrow),
    startTime: clockText(now.getUTCHours(), now.getUTCMinutes()),
    endTime: clockText(tomorrow.getUTCHours(), tomorrow.getUTCMinutes()),
  }
}

export function resolveTimeRange(range: PlanningTimeRange) {
  if (!range.endDate) return { error: 'Select an end date.', value: null }
  const startTime = parseClockTime(range.startTime)
  const endTime = parseClockTime(range.endTime)
  if (!startTime || !endTime) return { error: 'Enter both times in 24-hour format, such as 09:30.', value: null }
  for (const day of [range.startDate, range.endDate]) {
    const date = new Date(`${day}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())
      || dayKey(date) !== day || day < MIN_DAY || day > MAX_DAY) {
      return { error: 'Choose dates between 1962 and 2649.', value: null }
    }
  }
  const start = `${range.startDate}T${clockText(startTime.hours, startTime.minutes)}:00Z`
  const end = `${range.endDate}T${clockText(endTime.hours, endTime.minutes)}:00Z`
  const duration = Date.parse(end) - Date.parse(start)
  if (duration <= 0) return { error: 'The end must be after the start. For an overnight range, select the following day.', value: null }
  if (duration > 366 * DAY_MS) return { error: 'Choose a time range of 366 days or less.', value: null }
  return { error: null, value: { start, end, durationMinutes: duration / 60_000 } }
}
