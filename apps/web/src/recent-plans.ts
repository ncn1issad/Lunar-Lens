import type { TimelineResponse } from '@lunar-lense/contracts'
import { locationDraft, normalizeLongitude, sameLocation } from './planning-location'
import type { LunarLocation } from './planning-location'
import { resolveTimeRange } from './planning-time'
import type { PlanningTimeRange } from './planning-time'
import { visibilityGradient } from './surface-timeline'

export interface RecentPlan {
  id: string
  location: LunarLocation
  range: PlanningTimeRange
  visibility: string
}

export function matchesRecentPlan(plan: RecentPlan, location: LunarLocation, range: PlanningTimeRange | null): boolean {
  if (!range || !sameLocation(plan.location, location)) return false
  const selected = resolveTimeRange(range).value
  const saved = resolveTimeRange(plan.range).value
  return Boolean(selected && saved && selected.start === saved.start && selected.end === saved.end)
}

/** Keep small summaries, rather than retaining ten full ephemeris responses. */
export function rememberPlan(recent: RecentPlan[], timeline: TimelineResponse): RecentPlan[] {
  const location = {
    latitude: timeline.observer.latitudeDeg,
    longitude: normalizeLongitude(timeline.observer.longitudeDeg),
  }
  const { start, end } = timeline.range
  const range = {
    startDate: start.slice(0, 10), endDate: end.slice(0, 10),
    startTime: start.slice(11, 16), endTime: end.slice(11, 16),
  }
  const draft = locationDraft(location)
  const plan = {
    id: `${draft.latitude},${draft.longitude}:${start}:${end}`,
    location, range, visibility: visibilityGradient(timeline.positions),
  }
  return [plan, ...recent.filter(previous => !matchesRecentPlan(previous, location, range))].slice(0, 10)
}
