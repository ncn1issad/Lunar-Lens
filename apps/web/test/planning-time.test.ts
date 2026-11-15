import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DAY_MS, addDays, addMonths, clampCalendarMonth, clockValueAtPoint, defaultTimeRange,
  monthCells, parseClockTime, resolveTimeRange, selectRangeDate, setClockPeriod, setClockUnit,
} from '../src/planning-time.ts'

test('calendar handles leap days, year boundaries, and Monday-first weeks', () => {
  const february = monthCells('2028-02-01').filter(Boolean)
  assert.equal(february.length, 29)
  assert.equal(february.at(-1), '2028-02-29')
  assert.equal(monthCells('2026-11-01')[6], '2026-11-01')
  assert.equal(addMonths('2026-12-01', 1), '2027-01-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(clampCalendarMonth('2650-01-01'), '2649-11-01')
  assert.equal(clampCalendarMonth('1961-12-01'), '1962-01-01')
})

test('two date clicks select an inclusive range in either order, then restart', () => {
  const initial = defaultTimeRange(new Date('2026-12-01T09:30:00Z'))
  const first = selectRangeDate(initial, '2026-12-31')
  assert.equal(first.endDate, null)
  const reverse = selectRangeDate(first, '2026-12-28')
  assert.equal(reverse.startDate, '2026-12-28')
  assert.equal(reverse.endDate, '2026-12-31')
  assert.equal(selectRangeDate(reverse, '2027-01-01').endDate, null)
  assert.equal(selectRangeDate(first, '2026-12-31').endDate, '2026-12-31')
})

test('typed 24-hour times and AM/PM conversion distinguish noon and midnight', () => {
  assert.deepEqual(parseClockTime('9:05'), { hours: 9, minutes: 5 })
  assert.deepEqual(parseClockTime('2359'), { hours: 23, minutes: 59 })
  for (const value of ['24:00', '12:60', '9:5', '-1:30', 'oops', '']) assert.equal(parseClockTime(value), null)
  assert.equal(setClockPeriod('00:30', 'PM'), '12:30')
  assert.equal(setClockPeriod('12:30', 'AM'), '00:30')
  assert.equal(setClockUnit('23:17', 'hours', 12), '12:17')
  assert.equal(setClockUnit('00:17', 'hours', 12), '00:17')
  assert.equal(setClockUnit('14:30', 'minutes', 59), '14:59')
})

test('clock pointers use clockwise angles with twelve or zero at the top', () => {
  assert.equal(clockValueAtPoint(0, -100, 'hours'), 12)
  assert.equal(clockValueAtPoint(100, 0, 'hours'), 3)
  assert.equal(clockValueAtPoint(0, 100, 'hours'), 6)
  assert.equal(clockValueAtPoint(-100, 0, 'minutes'), 45)
  assert.equal(clockValueAtPoint(0, -100, 'minutes'), 0)
})

test('API-ready timestamps stay in UTC across DST transitions', () => {
  const range = { startDate: '2026-10-25', endDate: '2026-10-26', startTime: '0930', endTime: '09:30' }
  assert.deepEqual(resolveTimeRange(range).value, {
    start: '2026-10-25T09:30:00Z', end: '2026-10-26T09:30:00Z', durationMinutes: 1440,
  })
})

test('validation enforces chronological timestamps and the existing API bounds', () => {
  const base = { startDate: '2026-01-01', endDate: '2026-01-01', startTime: '20:00', endTime: '08:00' }
  assert.match(resolveTimeRange(base).error!, /end must be after/)
  assert.equal(resolveTimeRange({ ...base, endDate: '2026-01-02' }).error, null)
  assert.match(resolveTimeRange({ ...base, endDate: null }).error!, /end date/)
  assert.match(resolveTimeRange({ ...base, startDate: '2026-02-30' }).error!, /dates/)
  assert.match(resolveTimeRange({ ...base, startDate: '1961-12-31' }).error!, /1962/)
  const valid = { ...base, startTime: '00:00', endTime: '00:00', endDate: addDays(base.startDate, 366) }
  assert.equal(Date.parse(resolveTimeRange(valid).value!.end) - Date.parse(resolveTimeRange(valid).value!.start), 366 * DAY_MS)
  assert.match(resolveTimeRange({ ...valid, endDate: addDays(base.startDate, 367) }).error!, /366/)
})
