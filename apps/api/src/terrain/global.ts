import type { GlobalTerrainManifest, MoonQuery, TerrainLodMetadata } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import { normalizeLongitude } from './geometry.js';
import { validateManifest, type AssetFetcher, type LoadedTerrain, type TerrainSurface } from './loader.js';
import { loadTiles } from './tiles.js';

export const NEAR_RADIUS_M = 60_000;
const DEG = Math.PI / 180;

async function loadLevel(query: MoonQuery, ppd: 64 | 16, distanceM: number, fetchAsset: AssetFetcher) {
  const directory = `/terrain/ldem_${ppd}`;
  let m: GlobalTerrainManifest;
  try {
    const response = await fetchAsset(`${directory}/manifest.json`);
    if (!response.ok) throw new Error('manifest unavailable');
    const value = validateManifest(await response.json());
    if (value.projection !== 'simple-cylindrical' || value.encoding !== 'int16-le'
      || value.pixelsPerDegree !== ppd || value.sourceProduct !== `LDEM_${ppd}`
      || value.sourceVersion !== 'V3.1') throw new Error('wrong level');
    m = value;
  } catch {
    throw new TerrainError(`Global LDEM_${ppd} assets are unavailable or invalid. Run python3 scripts/prepare-global-terrain.py and rebuild.`, 'TERRAIN_UNAVAILABLE', 503);
  }
  const arc = distanceM / m.referenceRadiusM;
  const north = Math.min(90, query.latitude + arc / DEG);
  const south = Math.max(-90, query.latitude - arc / DEG);
  // The cap beyond the first/last pixel centres interpolates to a single pole
  // height, the mean of that complete latitude ring, independent of longitude.
  const polar = north >= 90 - 0.5 / ppd || south <= -90 + 0.5 / ppd;
  const lonSpan = polar ? 180 : Math.asin(Math.min(1, Math.sin(arc) / Math.cos(query.latitude * DEG))) / DEG;
  const longitude = normalizeLongitude(query.longitude);
  const minX = Math.floor((longitude - lonSpan) * ppd - 0.5);
  const maxX = Math.floor((longitude + lonSpan) * ppd - 0.5) + 1;
  const minY = Math.max(0, Math.floor((90 - north) * ppd - 0.5));
  const maxY = Math.min(m.height - 1, Math.floor((90 - south) * ppd - 0.5) + 1);
  const wrap = (x: number) => ((x % m.width) + m.width) % m.width;
  const columns = new Set<number>();
  const add = (a: number, b: number) => {
    for (let col = Math.floor(a / m.tileSize); col <= Math.floor(b / m.tileSize); col++) columns.add(col);
  };
  if (maxX - minX + 1 >= m.width) add(0, m.width - 1);
  else if (wrap(minX) <= wrap(maxX)) add(wrap(minX), wrap(maxX));
  else { add(wrap(minX), m.width - 1); add(0, wrap(maxX)); }
  const keys: string[] = [];
  for (let row = Math.floor(minY / m.tileSize); row <= Math.floor(maxY / m.tileSize); row++) {
    for (const col of columns) keys.push(`${col}-${row}.bin`);
  }
  const { tiles, loadedBytes } = await loadTiles(m, keys, fetchAsset, directory);
  const tileColumns = Math.ceil(m.width / m.tileSize);
  const tileGrid: (DataView | undefined)[] = [];
  for (const [key, view] of tiles) {
    const [column, row] = key.replace('.bin', '').split('-').map(Number);
    tileGrid[row! * tileColumns + column!] = view;
  }
  const value = (column: number, row: number): number => {
    const col = column < 0 ? column + m.width : column >= m.width ? column - m.width : column;
    const tile = tileGrid[Math.floor(row / m.tileSize) * tileColumns + Math.floor(col / m.tileSize)];
    const raw = tile?.getInt16(((row % m.tileSize) * m.tileSize + col % m.tileSize) * 2, true);
    if (raw === undefined || raw === m.noData) throw new TerrainError('A required global terrain height is missing.', 'TERRAIN_MISSING_DATA', 422);
    return raw * m.heightScaleM;
  };
  let northHeight: number | undefined, southHeight: number | undefined;
  const poleHeight = (row: number) => {
    let sum = 0;
    for (let col = 0; col < m.width; col++) sum += value(col, row);
    return sum / m.width;
  };
  const sampleRow = (x: number, row: number) => {
    const i = Math.floor(x), a = x - i;
    return value(i, row) * (1 - a) + value(i + 1, row) * a;
  };
  return {
    manifest: m, loadedTileCount: tiles.size, loadedBytes,
    resolutionM: m.referenceRadiusM * DEG / ppd,
    sample(latitude: number, lon: number) {
      const x = (lon >= 0 && lon < 360 ? lon : normalizeLongitude(lon)) * ppd - 0.5;
      const y = (90 - latitude) * ppd - 0.5;
      if (y < 0) {
        northHeight ??= poleHeight(0);
        return northHeight * (-2 * y) + sampleRow(x, 0) * (1 + 2 * y);
      }
      if (y > m.height - 1) {
        southHeight ??= poleHeight(m.height - 1);
        const a = 2 * (y - (m.height - 1));
        return southHeight * a + sampleRow(x, m.height - 1) * (1 - a);
      }
      const j = Math.min(m.height - 2, Math.floor(y)), b = y - j;
      return sampleRow(x, j) * (1 - b) + sampleRow(x, j + 1) * b;
    },
    visitFarCells: ((visitor) => {
      const sinObserver = Math.sin(query.latitude * DEG), cosObserver = Math.cos(query.latitude * DEG);
      const sinLongitude = new Float64Array(m.width), cosLongitude = new Float64Array(m.width);
      for (let col = 0; col < m.width; col++) {
        const delta = ((col + 0.5) / ppd - query.longitude) * DEG;
        sinLongitude[col] = Math.sin(delta); cosLongitude[col] = Math.cos(delta);
      }
      const halfCell = DEG / ppd / 2;
      for (let row = minY; row <= maxY; row++) {
        const latitude = (90 - (row + 0.5) / ppd) * DEG;
        const sinLat = Math.sin(latitude), cosLat = Math.cos(latitude);
        // Great-circle radius to the farthest pixel-region corner. Its circular
        // envelope covers the complete angular width, including between rays.
        const radiusM = m.referenceRadiusM * 2 * Math.asin(Math.sqrt(
          Math.sin(halfCell / 2) ** 2 + cosLat
          * Math.cos(Math.max(0, Math.abs(latitude) - halfCell)) * Math.sin(halfCell / 2) ** 2,
        )) + 0.000001;
        for (const column of columns) {
          for (let col = column * m.tileSize; col < Math.min(m.width, (column + 1) * m.tileSize); col++) {
            const east = cosLat * sinLongitude[col]!;
            const northward = cosObserver * sinLat - sinObserver * cosLat * cosLongitude[col]!;
            const sinDistance = Math.hypot(east, northward);
            const cosine = sinObserver * sinLat + cosObserver * cosLat * cosLongitude[col]!;
            const centerDistance = m.referenceRadiusM * Math.atan2(sinDistance, cosine);
            if (centerDistance + radiusM <= NEAR_RADIUS_M || centerDistance - radiusM > distanceM) continue;
            visitor({
              azimuthDeg: normalizeLongitude(Math.atan2(east, northward) / DEG),
              angularRadiusDeg: Math.asin(Math.min(1, Math.sin(radiusM / m.referenceRadiusM) / sinDistance)) / DEG,
              heightM: value(col, row), minDistanceM: Math.max(NEAR_RADIUS_M, centerDistance - radiusM),
              maxDistanceM: Math.min(distanceM, centerDistance + radiusM),
            });
          }
        }
      }
    }) satisfies NonNullable<TerrainSurface['visitFarCells']>,
  };
}

/** Calculation data only. Fine imagery terrain is never requested here. */
export async function loadGlobalTerrain(query: MoonQuery, fetchAsset: AssetFetcher): Promise<LoadedTerrain> {
  const nearEnd = Math.min(query.maxDistanceM, NEAR_RADIUS_M);
  const near = await loadLevel(query, 64, nearEnd, fetchAsset);
  const far = query.maxDistanceM > NEAR_RADIUS_M ? await loadLevel(query, 16, query.maxDistanceM, fetchAsset) : undefined;
  const loadedBytes = near.loadedBytes + (far?.loadedBytes ?? 0);
  if (loadedBytes > 48 * 1024 * 1024) throw new TerrainError('Global terrain exceeds the 48 MiB buffer budget.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  const layers: TerrainLodMetadata['layers'] = [near, ...(far ? [far] : [])].map((level, index) => {
    const { tiles: _tiles, ...metadata } = level.manifest;
    return { ...metadata, minDistanceM: index ? NEAR_RADIUS_M : 0,
      maxDistanceM: index ? query.maxDistanceM : nearEnd, distanceStepM: level.resolutionM / 2,
      loadedBytes: level.loadedBytes, loadedTileCount: level.loadedTileCount };
  });
  return {
    manifest: {
      format: 'lunar-dem-lod-v1', id: 'lola-global-64-16-v3.1', source: near.manifest.source,
      sourceProduct: far ? 'LDEM_64 + LDEM_16' : 'LDEM_64', sourceVersion: 'V3.1',
      sourceUrl: near.manifest.sourceUrl.replace(/ldem_64\.img$/i, ''),
      referenceFrame: near.manifest.referenceFrame, referenceRadiusM: near.manifest.referenceRadiusM,
      projection: 'simple-cylindrical', layers,
    },
    referenceRadiusM: near.manifest.referenceRadiusM, resolutionM: near.resolutionM,
    loadedBytes, loadedTileCount: near.loadedTileCount + (far?.loadedTileCount ?? 0),
    samplingBands: layers.map(layer => ({ startM: layer.minDistanceM, endM: layer.maxDistanceM, stepM: layer.distanceStepM })),
    sample: (lat, lon, distance = 0) => distance > NEAR_RADIUS_M && far ? far.sample(lat, lon) : near.sample(lat, lon),
    ...(far ? { visitFarCells: far.visitFarCells } : {}),
  };
}
