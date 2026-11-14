import type { MoonQuery, TerrainManifest } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import { normalizeLongitude } from './geometry.js';

export interface TerrainSurface {
  referenceRadiusM: number;
  /** Smallest physical grid spacing in the search area, for radial sampling. */
  resolutionM: number;
  sample(latitude: number, longitude: number): number;
}

export interface LoadedTerrain extends TerrainSurface {
  manifest: TerrainManifest;
  loadedTileCount: number;
  loadedBytes: number;
}

export type AssetFetcher = (path: string) => Promise<Response>;

function unavailable(message: string): never {
  throw new TerrainError(message, 'TERRAIN_UNAVAILABLE', 503);
}

export function validateManifest(value: unknown): TerrainManifest {
  if (!value || typeof value !== 'object') unavailable('Terrain manifest is invalid.');
  const m = value as TerrainManifest;
  if (m.format !== 'lunar-dem-f32-v1' || m.referenceFrame !== 'MOON_ME_DE421'
    || m.referenceRadiusM !== 1737400 || m.projection !== 'simple-cylindrical'
    || m.registration !== 'pixel-center' || m.heightUnit !== 'meter'
    || m.encoding !== 'float32-le' || m.noData !== 'NaN'
    || !Number.isInteger(m.pixelsPerDegree) || m.pixelsPerDegree < 1 || m.pixelsPerDegree > 1024
    || !Number.isInteger(m.tileSize) || m.tileSize < 1 || m.tileSize > 1024
    || ![m.northDeg, m.southDeg, m.westDeg, m.eastDeg].every(Number.isFinite)
    || m.northDeg > 90 || m.southDeg < -90 || m.northDeg <= m.southDeg
    || m.westDeg < 0 || m.eastDeg > 360 || m.eastDeg <= m.westDeg
    || !m.tiles || typeof m.tiles !== 'object' || Array.isArray(m.tiles)
    || ![m.id, m.source, m.sourceUrl, m.sourceProduct, m.sourceVersion].every(v => typeof v === 'string' && v.length > 0)
    || !m.preparation || !/^[a-f0-9]{64}$/.test(m.preparation.sourceLabelSha256)
    || !Array.isArray(m.preparation.sourceRangesSha256)
    || !m.preparation.sourceRangesSha256.every(v => /^[a-f0-9]{64}$/.test(v))) {
    unavailable('Terrain manifest has unsupported geometry or encoding.');
  }
  for (const span of [m.northDeg - m.southDeg, m.eastDeg - m.westDeg]) {
    if (!Number.isInteger(span * m.pixelsPerDegree / m.tileSize)) {
      unavailable('Terrain coverage must contain whole tiles.');
    }
  }
  if (!Object.entries(m.tiles).every(([key, hash]) => /^\d+-\d+\.bin$/.test(key) && /^[a-f0-9]{64}$/.test(hash))) {
    unavailable('Terrain tile index is invalid.');
  }
  return m;
}

/** Loads each required tile once per calculation. No cross-request result cache. */
export async function loadTerrain(query: MoonQuery, fetchAsset: AssetFetcher): Promise<LoadedTerrain> {
  let manifest: TerrainManifest;
  try {
    const response = await fetchAsset('/terrain/manifest.json');
    if (!response.ok) unavailable('Terrain assets are not prepared. Run python3 scripts/prepare-terrain.py and rebuild.');
    manifest = validateManifest(await response.json());
  } catch (error) {
    if (error instanceof TerrainError) throw error;
    unavailable('Cannot load the terrain manifest.');
  }
  const m = manifest;
  const longitude = normalizeLongitude(query.longitude);
  const angularDistance = query.maxDistanceM / m.referenceRadiusM;
  const latSpan = angularDistance * 180 / Math.PI;
  const north = query.latitude + latSpan, south = query.latitude - latSpan;
  const reachesPole = north >= 90 || south <= -90;
  const lonSpan = reachesPole ? 180 : Math.asin(Math.min(1,
    Math.sin(angularDistance) / Math.cos(query.latitude * Math.PI / 180))) * 180 / Math.PI;
  const width = (m.eastDeg - m.westDeg) * m.pixelsPerDegree;
  const height = (m.northDeg - m.southDeg) * m.pixelsPerDegree;
  const global = m.westDeg === 0 && m.eastDeg === 360;
  const x = (lon: number) => (lon - m.westDeg) * m.pixelsPerDegree - 0.5;
  const y = (lat: number) => (m.northDeg - lat) * m.pixelsPerDegree - 0.5;
  // Include all four interpolation neighbours, including across tile boundaries.
  const minX = Math.floor(x(longitude - lonSpan));
  const maxX = Math.floor(x(longitude + lonSpan)) + 1;
  const minY = Math.floor(y(Math.min(90, north)));
  const maxY = Math.floor(y(Math.max(-90, south))) + 1;
  if ((!global && (minX < 0 || maxX >= width)) || minY < 0 || maxY >= height) {
    throw new TerrainError(
      `Observer and search area exceed prepared coverage (${m.southDeg} to ${m.northDeg} latitude, ${m.westDeg} to ${m.eastDeg} east longitude). Reduce maxDistanceM or prepare more terrain.`,
      'TERRAIN_OUT_OF_COVERAGE', 422,
    );
  }
  const tiles = new Map<string, DataView>();
  const wrapX = (col: number) => ((col % width) + width) % width;
  const columns = new Set<number>();
  for (let col = minX; col <= maxX; col += m.tileSize) columns.add(Math.floor(wrapX(col) / m.tileSize));
  columns.add(Math.floor(wrapX(maxX) / m.tileSize));
  const byteLength = m.tileSize * m.tileSize * 4;
  const firstRow = Math.floor(minY / m.tileSize), lastRow = Math.floor(maxY / m.tileSize);
  if (columns.size * (lastRow - firstRow + 1) * byteLength > 48 * 1024 * 1024) {
    throw new TerrainError('Search area needs more than the 48 MiB terrain budget. Reduce maxDistanceM.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  // Sequential loads bound transient memory while each buffer is verified.
  for (let row = firstRow; row <= lastRow; row++) {
    for (const col of columns) {
      const key = `${col}-${row}.bin`;
      const hash = m.tiles[key];
      if (!hash) unavailable(`Prepared terrain tile ${key} is absent from the manifest.`);
      try {
        const response = await fetchAsset(`/terrain/${key}`);
        if (!response.ok) unavailable(`Cannot load terrain tile ${key}.`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== byteLength) unavailable(`Terrain tile ${key} has an invalid size.`);
        const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
          .map(v => v.toString(16).padStart(2, '0')).join('');
        if (actual !== hash) unavailable(`Terrain tile ${key} failed its integrity check.`);
        tiles.set(key, new DataView(buffer));
      } catch (error) {
        if (error instanceof TerrainError) throw error;
        unavailable(`Cannot load terrain tile ${key}.`);
      }
    }
  }
  function value(col: number, row: number): number {
    if (row < 0 || row >= height || (!global && (col < 0 || col >= width))) {
      throw new TerrainError('A requested terrain sample is outside prepared coverage.', 'TERRAIN_OUT_OF_COVERAGE', 422);
    }
    col = wrapX(col);
    const tile = tiles.get(`${Math.floor(col / m.tileSize)}-${Math.floor(row / m.tileSize)}.bin`);
    const v = tile?.getFloat32(((row % m.tileSize) * m.tileSize + col % m.tileSize) * 4, true);
    if (v === undefined || !Number.isFinite(v) || v < -20000 || v > 20000) {
      throw new TerrainError('A required terrain sample is missing or invalid.', 'TERRAIN_MISSING_DATA', 422);
    }
    return v;
  }
  return {
    manifest: m, referenceRadiusM: m.referenceRadiusM,
    resolutionM: m.referenceRadiusM * Math.PI / (180 * m.pixelsPerDegree)
      * Math.cos(Math.max(Math.abs(north), Math.abs(south)) * Math.PI / 180),
    loadedTileCount: tiles.size, loadedBytes: tiles.size * byteLength,
    sample(latitude, lon) {
      const px = x(normalizeLongitude(lon)), py = y(latitude);
      const i = Math.floor(px), j = Math.floor(py), a = px - i, b = py - j;
      const v00 = value(i, j), v10 = value(i + 1, j);
      const v01 = value(i, j + 1), v11 = value(i + 1, j + 1);
      return (v00 * (1 - a) + v10 * a) * (1 - b) + (v01 * (1 - a) + v11 * a) * b;
    },
  };
}
