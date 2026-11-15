import { Body, Illumination, KM_PER_AU } from 'astronomy-engine'
import type { TimelineResponse } from '@lunar-lense/contracts'
import type { SurfaceSnapshot } from './surface-geometry'

export const SURFACE_PLAN_STORAGE_KEY = 'lunar-lense:surface-plan'

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
    const snapshot = JSON.parse(sessionStorage.getItem(SURFACE_PLAN_STORAGE_KEY) ?? 'null') as SurfaceSnapshot | null
    if (!snapshot || !Number.isFinite(Date.parse(snapshot.timestamp))
      || ![snapshot.latitudeDeg, snapshot.longitudeDeg, snapshot.eyeHeightM, snapshot.groundElevationM,
        snapshot.positions.earth.azimuthDeg, snapshot.positions.earth.elevationDeg, snapshot.positions.earth.distanceKm,
        snapshot.positions.sun.azimuthDeg, snapshot.positions.sun.elevationDeg, snapshot.positions.sun.distanceKm].every(Number.isFinite)
      || Math.abs(snapshot.latitudeDeg) > 90 || snapshot.longitudeDeg < 0 || snapshot.longitudeDeg >= 360
      || snapshot.eyeHeightM <= 0 || snapshot.positions.earth.distanceKm <= 0 || snapshot.positions.sun.distanceKm <= 0) return null
    return snapshot
  } catch { return null }
}
