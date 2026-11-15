import { Vector3 } from 'three'

export interface LunarLocation { latitude: number; longitude: number }
export interface LocationDraft { latitude: string; longitude: string }
export const LOCATION_STORAGE_KEY = 'lunar-lense:planning-location'

// Apollo module coordinates, MOON_ME DE421, from NASA's LRO-based site table:
// https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html
export const locationPresets = [
  { name: 'Marius Hills', latitude: 14, longitude: -57 },
  { name: 'South pole', latitude: -90, longitude: 0 },
  { name: 'North pole', latitude: 90, longitude: 0 },
  { name: 'Apollo 11', latitude: 0.67416, longitude: 23.47314 },
  { name: 'Apollo 12', latitude: -3.0128, longitude: -23.4219 },
  { name: 'Apollo 14', latitude: -3.64589, longitude: -17.47194 },
  { name: 'Apollo 15', latitude: 26.13239, longitude: 3.6333 },
  { name: 'Apollo 16', latitude: -8.9734, longitude: 15.5011 },
  { name: 'Apollo 17', latitude: 20.1911, longitude: 30.7723 },
] as const

export function normalizeLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

export function resolveLocation(draft: LocationDraft): { location: LunarLocation | null; error: string | null } {
  if (!draft.latitude.trim() || !draft.longitude.trim()) return { location: null, error: 'Enter latitude and longitude.' }
  const latitude = Number(draft.latitude), longitude = Number(draft.longitude)
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return { location: null, error: 'Latitude must be between -90° and 90°.' }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 360) return { location: null, error: 'Longitude must be between -180° and 360°.' }
  return { location: { latitude, longitude: normalizeLongitude(longitude) }, error: null }
}

export function locationDraft(location: LunarLocation): LocationDraft {
  return { latitude: String(Number(location.latitude.toFixed(5))), longitude: String(Number(location.longitude.toFixed(5))) }
}

export function initialLocationDraft(): LocationDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LOCATION_STORAGE_KEY) ?? 'null')
    if (saved && typeof saved.latitude === 'string' && typeof saved.longitude === 'string' && resolveLocation(saved).location) return saved
  } catch { /* Storage is optional. */ }
  return locationDraft(locationPresets[0])
}

/** Match SphereGeometry's texture axes, longitude 0 at +X, east toward -Z. */
export function locationNormal(location: LunarLocation) {
  const lat = location.latitude * Math.PI / 180, lon = location.longitude * Math.PI / 180
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon))
}

export function locationFromPoint(point: Vector3): LunarLocation {
  const normal = point.clone().normalize()
  return {
    latitude: Math.asin(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI,
    longitude: normalizeLongitude(Math.atan2(-normal.z, normal.x) * 180 / Math.PI),
  }
}

export function locationLabel(location: LunarLocation) {
  return `${Math.abs(location.latitude).toFixed(2)}° ${location.latitude < 0 ? 'S' : 'N'} / ${Math.abs(location.longitude).toFixed(2)}° ${location.longitude < 0 ? 'W' : 'E'}`
}
