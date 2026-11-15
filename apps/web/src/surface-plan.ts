import { Body, Illumination, KM_PER_AU } from 'astronomy-engine'
import type { TimelinePositions, TimelineResponse } from '@lunar-lense/contracts'
import type { SurfaceSnapshot } from './surface-geometry'

export const SURFACE_PLAN_STORAGE_KEY = 'lunar-lense:surface-plan'

export interface SurfacePlan {
  snapshot: SurfaceSnapshot
  positions: TimelinePositions
}

function validPositions(positions: TimelinePositions, start: string): boolean {
  if (!Array.isArray(positions?.earth) || !positions.earth.length
    || !Array.isArray(positions.sun) || positions.sun.length !== positions.earth.length) return false
  let previous = -Infinity
  return positions.earth.every((earth, index) => {
    const sun = positions.sun[index]
    const time = Date.parse(earth?.timestamp)
    const valid = earth && sun && earth.timestamp === sun.timestamp && Number.isFinite(time) && time > previous
      && (index !== 0 || earth.timestamp === start)
      && [earth.azimuthDeg, earth.elevationDeg, sun.azimuthDeg, sun.elevationDeg].every(Number.isFinite)
    previous = time
    return Boolean(valid)
  })
}

export function createSurfacePlan(timeline: TimelineResponse): SurfacePlan {
  const snapshot = startSurfaceSnapshot(timeline)
  if (!validPositions(timeline.positions, snapshot.timestamp)) {
    throw new Error('The timeline response has invalid surface samples. Try again.')
  }
  return { snapshot, positions: timeline.positions }
}

/** Interpolate directions only within the returned samples, including the azimuth seam. */
export function surfaceSnapshotAt(plan: SurfacePlan, timestamp: number): SurfaceSnapshot {
  const { earth, sun } = plan.positions
  const time = Math.max(Date.parse(earth[0]!.timestamp), Math.min(timestamp, Date.parse(earth.at(-1)!.timestamp)))
  let low = 0, high = earth.length - 1
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Date.parse(earth[middle]!.timestamp) <= time) low = middle
    else high = middle - 1
  }
  const next = Math.min(low + 1, earth.length - 1)
  const start = Date.parse(earth[low]!.timestamp), end = Date.parse(earth[next]!.timestamp)
  const fraction = end === start ? 0 : (time - start) / (end - start)
  const moon = Illumination(Body.Moon, new Date(time))
  const direction = (positions: TimelinePositions['earth'], distanceKm: number) => {
    const a = positions[low]!, b = positions[next]!
    const delta = ((b.azimuthDeg - a.azimuthDeg + 540) % 360) - 180
    return {
      azimuthDeg: ((a.azimuthDeg + delta * fraction) % 360 + 360) % 360,
      elevationDeg: a.elevationDeg + (b.elevationDeg - a.elevationDeg) * fraction,
      distanceKm,
    }
  }
  return {
    ...plan.snapshot, timestamp: new Date(time).toISOString().replace('.000Z', 'Z'),
    positions: {
      earth: direction(earth, moon.geo_dist * KM_PER_AU),
      sun: direction(sun, moon.helio_dist * KM_PER_AU),
    },
  }
}

export function startSurfaceSnapshot(timeline: TimelineResponse): SurfaceSnapshot {
  const earth = timeline.positions?.earth?.[0], sun = timeline.positions?.sun?.[0]
  const observer = timeline.observer
  if (!earth || !sun || earth.timestamp !== timeline.range?.start || sun.timestamp !== earth.timestamp
    || !Number.isFinite(Date.parse(earth.timestamp)) || !observer
    || ![observer.latitudeDeg, observer.longitudeDeg, observer.groundElevationM, observer.eyeHeightM,
      earth.azimuthDeg, earth.elevationDeg, sun.azimuthDeg, sun.elevationDeg].every(Number.isFinite)) {
    throw new Error('The timeline response is missing the starting surface conditions. Try again.')
  }
  // Horizons supplies the directions. Distances only set the apparent disc sizes.
  const moon = Illumination(Body.Moon, new Date(earth.timestamp))
  return {
    timestamp: earth.timestamp,
    latitudeDeg: observer.latitudeDeg,
    longitudeDeg: ((observer.longitudeDeg % 360) + 360) % 360,
    eyeHeightM: observer.eyeHeightM,
    groundElevationM: observer.groundElevationM,
    source: timeline.source,
    positions: {
      earth: { ...earth, distanceKm: moon.geo_dist * KM_PER_AU },
      sun: { ...sun, distanceKm: moon.helio_dist * KM_PER_AU },
    },
  }
}

export function savedSurfaceSnapshot(): SurfaceSnapshot | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SURFACE_PLAN_STORAGE_KEY) ?? 'null')
    const snapshot = (saved?.snapshot ?? saved) as SurfaceSnapshot | null
    if (!snapshot || !Number.isFinite(Date.parse(snapshot.timestamp))
      || ![snapshot.latitudeDeg, snapshot.longitudeDeg, snapshot.eyeHeightM, snapshot.groundElevationM,
        snapshot.positions.earth.azimuthDeg, snapshot.positions.earth.elevationDeg, snapshot.positions.earth.distanceKm,
        snapshot.positions.sun.azimuthDeg, snapshot.positions.sun.elevationDeg, snapshot.positions.sun.distanceKm].every(Number.isFinite)
      || Math.abs(snapshot.latitudeDeg) > 90 || snapshot.longitudeDeg < 0 || snapshot.longitudeDeg >= 360
      || snapshot.eyeHeightM <= 0 || snapshot.positions.earth.distanceKm <= 0 || snapshot.positions.sun.distanceKm <= 0) return null
    return snapshot
  } catch { return null }
}

export function savedSurfacePlan(): SurfacePlan | null {
  const snapshot = savedSurfaceSnapshot()
  if (!snapshot) return null
  try {
    const saved = JSON.parse(sessionStorage.getItem(SURFACE_PLAN_STORAGE_KEY)!)
    if (saved.snapshot) return validPositions(saved.positions, snapshot.timestamp) ? { snapshot, positions: saved.positions } : null
    // Older tabs stored only the starting scene. Keep that view usable until the next submission.
    const position = (body: 'earth' | 'sun') => [{ ...snapshot.positions[body], timestamp: snapshot.timestamp, isVisible: false }]
    return { snapshot, positions: { earth: position('earth'), sun: position('sun') } }
  } catch { return null }
}
