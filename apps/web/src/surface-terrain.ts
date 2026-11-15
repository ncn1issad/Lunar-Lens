import type { GlobalTerrainManifest } from '@lunar-lense/contracts'
import { concurrent, surfaceGrid } from './surface-geometry'
import type { ImageryPatch, SurfaceSnapshot } from './surface-geometry'
import { sha256Hex } from './sha256'

const wrap = (value: number, size: number) => ((value % size) + size) % size

export function globalTerrainKeys(m: GlobalTerrainManifest, patch: ImageryPatch) {
  const minX = Math.floor(patch.westDeg * m.pixelsPerDegree - 0.5)
  const maxX = Math.floor(patch.eastDeg * m.pixelsPerDegree - 0.5) + 1
  const minY = Math.max(0, Math.floor((90 - patch.northDeg) * m.pixelsPerDegree - 0.5))
  const maxY = Math.min(m.height - 1, Math.floor((90 - patch.southDeg) * m.pixelsPerDegree - 0.5) + 1)
  const columns = new Set<number>()
  const reachesPole = minY === 0 || maxY === m.height - 1
  if (reachesPole || maxX - minX >= m.width) {
    for (let col = 0; col < Math.ceil(m.width / m.tileSize); col++) columns.add(col)
  } else {
    for (let col = Math.floor(minX / m.tileSize); col <= Math.floor(maxX / m.tileSize); col++) {
      columns.add(Math.floor(wrap(col * m.tileSize, m.width) / m.tileSize))
    }
  }
  const keys: string[] = []
  for (let row = Math.floor(minY / m.tileSize); row <= Math.floor(maxY / m.tileSize); row++) {
    for (const col of columns) keys.push(`${col}-${row}.bin`)
  }
  return keys
}

export function globalTerrainSampler(m: GlobalTerrainManifest, tiles: ReadonlyMap<string, DataView>) {
  const value = (column: number, row: number) => {
    const col = wrap(column, m.width)
    const tile = tiles.get(`${Math.floor(col / m.tileSize)}-${Math.floor(row / m.tileSize)}.bin`)
    const raw = tile?.getInt16(((row % m.tileSize) * m.tileSize + col % m.tileSize) * 2, true)
    if (raw === undefined || raw === m.noData) throw new Error('A surface terrain sample is unavailable.')
    return raw * m.heightScaleM
  }
  const poles = new Map<number, number>()
  const pole = (row: number) => {
    let height = poles.get(row)
    if (height === undefined) {
      height = 0
      for (let col = 0; col < m.width; col++) height += value(col, row) / m.width
      poles.set(row, height)
    }
    return height
  }
  const sampleRow = (x: number, row: number) => {
    const col = Math.floor(x), t = x - col
    return value(col, row) * (1 - t) + value(col + 1, row) * t
  }
  return (latitude: number, longitude: number) => {
    const x = wrap(longitude, 360) * m.pixelsPerDegree - 0.5
    const y = (90 - latitude) * m.pixelsPerDegree - 0.5
    if (y < 0) return pole(0) * (-2 * y) + sampleRow(x, 0) * (1 + 2 * y)
    if (y > m.height - 1) {
      const t = 2 * (y - (m.height - 1))
      return pole(m.height - 1) * t + sampleRow(x, m.height - 1) * (1 - t)
    }
    const row = Math.min(m.height - 2, Math.floor(y)), t = y - row
    return sampleRow(x, row) * (1 - t) + sampleRow(x, row + 1) * t
  }
}

export async function plannedTerrain(patch: ImageryPatch, snapshot: SurfaceSnapshot, base: string, signal: AbortSignal) {
  const directory = `${base}terrain/ldem_64/`
  const response = await fetch(`${directory}manifest.json`, { signal })
  if (!response.ok) throw new Error('The global terrain manifest could not load.')
  const m = await response.json() as GlobalTerrainManifest
  if (m.projection !== 'simple-cylindrical' || m.encoding !== 'int16-le' || m.pixelsPerDegree !== 64
    || m.sourceProduct !== 'LDEM_64' || m.referenceRadiusM !== 1737400) {
    throw new Error('The global terrain does not match the timeline dataset.')
  }
  const tiles = new Map<string, DataView>()
  const keys = globalTerrainKeys(m, patch)
  if (keys.length * m.tileSize ** 2 * 2 > 48 * 1024 ** 2) throw new Error('The surface terrain exceeds the loading budget.')
  await concurrent(keys, async key => {
    signal.throwIfAborted()
    const response = await fetch(`${directory}${key}`, { signal })
    if (!response.ok) throw new Error('A global terrain tile could not load.')
    const buffer = await response.arrayBuffer()
    const hash = await sha256Hex(buffer)
    if (buffer.byteLength !== m.tileSize ** 2 * 2 || hash !== m.tiles[key]) {
      throw new Error('A global terrain tile failed its integrity check.')
    }
    tiles.set(key, new DataView(buffer))
  })
  signal.throwIfAborted()
  const sample = globalTerrainSampler(m, tiles)
  return surfaceGrid(patch, m.referenceRadiusM, sample, 512, snapshot)
}
