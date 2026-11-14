import type { MoonQuery, TerrainManifest, TerrainLodMetadata } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import { normalizeLongitude } from './geometry.js';
import { loadPolarTerrain } from './polar.js';
import { loadTiles } from './tiles.js';

export interface TerrainSurface {
  referenceRadiusM: number;
  /** Smallest physical grid spacing in the search area, for radial sampling. */
  resolutionM: number;
  sample(latitude: number, longitude: number, distanceM?: number): number;
  samplingBands?: readonly { startM: number; endM: number; stepM: number }[];
  visitFarCells?: (visitor: (cell: {
    azimuthDeg: number; angularRadiusDeg: number; heightM: number;
    minDistanceM: number; maxDistanceM: number;
  }) => void) => void;
}

export interface LoadedTerrain extends TerrainSurface {
  manifest: TerrainManifest | TerrainLodMetadata;
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
  if (m.referenceFrame !== 'MOON_ME_DE421'
    || m.referenceRadiusM !== 1737400
    || m.registration !== 'pixel-center' || m.heightUnit !== 'meter'
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
  if (m.projection === 'simple-cylindrical') {
    if (!Number.isInteger(m.pixelsPerDegree) || m.pixelsPerDegree < 1 || m.pixelsPerDegree > 1024) {
      unavailable('Terrain manifest has unsupported cylindrical encoding.');
    }
    if (m.encoding === 'int16-le') {
      if (m.format !== 'lunar-dem-i16-v1' || m.noData !== -32768 || m.heightScaleM !== 0.5
        || m.width !== 360 * m.pixelsPerDegree || m.height !== 180 * m.pixelsPerDegree
        || m.northDeg !== 90 || m.southDeg !== -90 || m.westDeg !== 0 || m.eastDeg !== 360
        || !/^[a-f0-9]{64}$/.test(m.preparation.sourceImageSha256 ?? '')) unavailable('Unsupported global terrain encoding.');
    } else {
      if (m.format !== 'lunar-dem-f32-v1' || m.encoding !== 'float32-le' || m.noData !== 'NaN') unavailable('Unsupported cylindrical encoding.');
      for (const span of [m.northDeg - m.southDeg, m.eastDeg - m.westDeg]) {
        if (!Number.isInteger(span * m.pixelsPerDegree / m.tileSize)) unavailable('Terrain coverage must contain whole tiles.');
      }
    }
  } else if (m.projection === 'polar-stereographic') {
    if (m.format !== 'lunar-dem-i16-v1' || m.encoding !== 'int16-le' || m.noData !== -32768
      || m.heightScaleM !== 0.5 || !['north', 'south'].includes(m.pole) || m.centralLongitudeDeg !== 0
      || !Number.isFinite(m.pixelSizeM) || m.pixelSizeM < 1 || m.pixelSizeM > 1000
      || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 2 || m.height < 2
      || m.width > 20000 || m.height > 20000
      || m.originXM !== -m.width * m.pixelSizeM / 2 || m.originYM !== m.height * m.pixelSizeM / 2
      || m.westDeg !== 0 || m.eastDeg !== 360
      || (m.pole === 'north' ? m.northDeg !== 90 || m.southDeg < 80 : m.southDeg !== -90 || m.northDeg > -80)
      || !/^[a-f0-9]{64}$/.test(m.preparation.sourceImageSha256 ?? '')) {
      unavailable('Terrain manifest has unsupported polar geometry or encoding.');
    }
  } else {
    unavailable('Terrain manifest has an unsupported projection.');
  }
  if (!Object.entries(m.tiles).every(([key, hash]) => /^\d+-\d+\.bin$/.test(key) && /^[a-f0-9]{64}$/.test(hash))) {
    unavailable('Terrain tile index is invalid.');
  }
  return m;
}

/** Loads each required tile once per calculation. No cross-request result cache. */
export async function loadTerrain(query: MoonQuery, fetchAsset: AssetFetcher): Promise<LoadedTerrain> {
  const directory = query.latitude >= 80 ? '/terrain/north' : query.latitude <= -80 ? '/terrain/south' : '/terrain';
  let manifest: TerrainManifest;
  try {
    const response = await fetchAsset(`${directory}/manifest.json`);
    if (!response.ok) {
      const script = directory === '/terrain' ? 'prepare-terrain.py' : 'prepare-polar-terrain.py';
      unavailable(`Terrain assets are not prepared. Run python3 scripts/${script} and rebuild.`);
    }
    manifest = validateManifest(await response.json());
  } catch (error) {
    if (error instanceof TerrainError) throw error;
    unavailable('Cannot load the terrain manifest.');
  }
  const m = manifest;
  if (directory !== '/terrain') {
    if (m.projection !== 'polar-stereographic'
      || m.pole !== (query.latitude >= 80 ? 'north' : 'south')) {
      unavailable('Terrain manifest does not match the selected polar region.');
    }
    return loadPolarTerrain(query, m, fetchAsset, directory);
  }
  if (m.projection !== 'simple-cylindrical') unavailable('Expected cylindrical terrain outside the polar regions.');
  if (m.encoding !== 'float32-le') unavailable('Regional loader expects float32 terrain.');
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
  const wrapX = (col: number) => ((col % width) + width) % width;
  const columns = new Set<number>();
  for (let col = minX; col <= maxX; col += m.tileSize) columns.add(Math.floor(wrapX(col) / m.tileSize));
  columns.add(Math.floor(wrapX(maxX) / m.tileSize));
  const firstRow = Math.floor(minY / m.tileSize), lastRow = Math.floor(maxY / m.tileSize);
  const keys: string[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (const col of columns) keys.push(`${col}-${row}.bin`);
  }
  const { tiles, loadedBytes } = await loadTiles(m, keys, fetchAsset, directory);
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
    loadedTileCount: tiles.size, loadedBytes,
    sample(latitude, lon) {
      const px = x(normalizeLongitude(lon)), py = y(latitude);
      const i = Math.floor(px), j = Math.floor(py), a = px - i, b = py - j;
      const v00 = value(i, j), v10 = value(i + 1, j);
      const v01 = value(i, j + 1), v11 = value(i + 1, j + 1);
      return (v00 * (1 - a) + v10 * a) * (1 - b) + (v01 * (1 - a) + v11 * a) * b;
    },
  };
}
