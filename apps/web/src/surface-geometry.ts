import type { CylindricalTerrainManifest, GeographicImageryLayer } from '@lunar-lense/contracts'

const radians = Math.PI / 180
export const previewSite = { latitudeDeg: 14, longitudeDeg: 303, eyeHeightM: 2 } as const
export const previewTimestamp = '2026-12-03T12:00:00Z'

export interface SurfaceSnapshot {
  timestamp: string
  latitudeDeg: number
  longitudeDeg: number
  eyeHeightM: number
  groundElevationM: number
  source: string
  positions: Record<'earth' | 'sun', { azimuthDeg: number; elevationDeg: number; distanceKm: number }>
}

/** Three.js axes are east (+X), up (+Y), and south (+Z). */
export function skyDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = azimuthDeg * radians, el = elevationDeg * radians
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]
}

export function localSurfacePoint(
  latitudeDeg: number, longitudeDeg: number, heightM: number, groundM: number, radiusM: number,
): [number, number, number] {
  const lat = latitudeDeg * radians, lat0 = previewSite.latitudeDeg * radians
  const lon = (longitudeDeg - previewSite.longitudeDeg) * radians
  const radius = radiusM + heightM
  const cosine = Math.sin(lat) * Math.sin(lat0) + Math.cos(lat) * Math.cos(lat0) * Math.cos(lon)
  return [
    radius * Math.cos(lat) * Math.sin(lon),
    heightM - groundM + radius * (cosine - 1),
    -radius * (Math.sin(lat) * Math.cos(lat0) - Math.cos(lat) * Math.sin(lat0) * Math.cos(lon)),
  ]
}

export function imageryPatch(layer: GeographicImageryLayer) {
  const z = layer.maxZoom
  const columns = layer.levelZeroColumns * 2 ** z, rows = layer.levelZeroRows * 2 ** z
  const longitude = previewSite.longitudeDeg - 360
  const minX = Math.floor((longitude - 1 + 180) / 360 * columns)
  const maxX = Math.floor((longitude + 1 + 180) / 360 * columns)
  const minY = Math.floor((90 - previewSite.latitudeDeg - 1) / 180 * rows)
  const maxY = Math.floor((90 - previewSite.latitudeDeg + 1) / 180 * rows)
  return {
    z, minX, maxX, minY, maxY,
    westDeg: minX / columns * 360 + 180,
    eastDeg: (maxX + 1) / columns * 360 + 180,
    northDeg: 90 - minY / rows * 180,
    southDeg: 90 - (maxY + 1) / rows * 180,
  }
}

export type ImageryPatch = ReturnType<typeof imageryPatch>

export function sampleTerrain(
  manifest: CylindricalTerrainManifest, tiles: ReadonlyMap<string, DataView>, latitude: number, longitude: number,
): number {
  const x = (longitude - manifest.westDeg) * manifest.pixelsPerDegree - 0.5
  const y = (manifest.northDeg - latitude) * manifest.pixelsPerDegree - 0.5
  const i = Math.floor(x), j = Math.floor(y), a = x - i, b = y - j
  const value = (column: number, row: number) => {
    const key = `${Math.floor(column / manifest.tileSize)}-${Math.floor(row / manifest.tileSize)}.bin`
    const tile = tiles.get(key)
    const height = tile?.getFloat32(((row % manifest.tileSize) * manifest.tileSize + column % manifest.tileSize) * 4, true)
    if (height === undefined || !Number.isFinite(height) || Math.abs(height) > 20000) {
      throw new Error('A surface terrain sample is unavailable.')
    }
    return height
  }
  return (value(i, j) * (1 - a) + value(i + 1, j) * a) * (1 - b)
    + (value(i, j + 1) * (1 - a) + value(i + 1, j + 1) * a) * b
}

/** Dense near the observer, coarser in the distance, with no height exaggeration. */
function coordinate(start: number, center: number, end: number, index: number, segments: number) {
  const t = index / segments * 2 - 1
  return center + Math.sign(t) * t * t * (t < 0 ? center - start : end - center)
}

export function surfaceGrid(
  patch: ImageryPatch, radiusM: number, sample: (latitude: number, longitude: number) => number, segments = 512,
) {
  const groundM = sample(previewSite.latitudeDeg, previewSite.longitudeDeg)
  const size = segments + 1
  const positions = new Float32Array(size * size * 3)
  const uvs = new Float32Array(size * size * 2)
  const indices = new Uint32Array(segments * segments * 6)
  for (let row = 0; row <= segments; row++) {
    const lat = coordinate(patch.southDeg, previewSite.latitudeDeg, patch.northDeg, segments - row, segments)
    for (let col = 0; col <= segments; col++) {
      const lon = coordinate(patch.westDeg, previewSite.longitudeDeg, patch.eastDeg, col, segments)
      const index = row * size + col
      positions.set(localSurfacePoint(lat, lon, sample(lat, lon), groundM, radiusM), index * 3)
      uvs.set([(lon - patch.westDeg) / (patch.eastDeg - patch.westDeg),
        (lat - patch.southDeg) / (patch.northDeg - patch.southDeg)], index * 2)
      if (row < segments && col < segments) {
        indices.set([index, index + size, index + 1, index + 1, index + size, index + size + 1],
          (row * segments + col) * 6)
      }
    }
  }
  return { positions, uvs, indices, groundM }
}

export async function concurrent<T>(items: readonly T[], operation: (item: T) => Promise<void>, count = 4) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
    while (next < items.length) await operation(items[next++]!)
  }))
}
