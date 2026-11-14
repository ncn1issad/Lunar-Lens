import type { MoonQuery, PolarTerrainManifest } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import type { AssetFetcher, LoadedTerrain } from './loader.js';
import { loadTiles } from './tiles.js';

const DEG = Math.PI / 180;

/** Spherical polar stereographic, true scale at the pole, east-positive longitude. */
export function projectPolar(latitude: number, longitude: number, pole: 'north' | 'south', radiusM: number) {
  const sign = pole === 'north' ? 1 : -1;
  const rho = 2 * radiusM * Math.tan((90 - sign * latitude) * DEG / 2);
  return { x: rho * Math.sin(longitude * DEG), y: -sign * rho * Math.cos(longitude * DEG) };
}

export async function loadPolarTerrain(
  query: MoonQuery, m: PolarTerrainManifest, fetchAsset: AssetFetcher, directory: string,
): Promise<LoadedTerrain> {
  const sign = m.pole === 'north' ? 1 : -1;
  const angularDistance = query.maxDistanceM / m.referenceRadiusM;
  const edgeLatitude = m.pole === 'north' ? m.southDeg : -m.northDeg;
  if (sign * query.latitude - angularDistance / DEG < edgeLatitude) {
    throw new TerrainError('Observer and search circle exceed the prepared polar latitude coverage. Reduce maxDistanceM.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  const point = projectPolar(query.latitude, query.longitude, m.pole, m.referenceRadiusM);
  const colatitude = (90 - sign * query.latitude) * DEG;
  // A spherical search circle projects to a Euclidean circle. Using its exact
  // centre/radius includes all rays, also when the search crosses the pole.
  const denominator = Math.cos(angularDistance) + Math.cos(colatitude);
  const factor = (1 + Math.cos(colatitude)) / denominator;
  const centerX = point.x * factor, centerY = point.y * factor;
  const radius = 2 * m.referenceRadiusM * Math.sin(angularDistance) / denominator;
  const pixelX = (x: number) => (x - m.originXM) / m.pixelSizeM - 0.5;
  const pixelY = (y: number) => (m.originYM - y) / m.pixelSizeM - 0.5;
  const minX = Math.floor(pixelX(centerX - radius));
  const maxX = Math.floor(pixelX(centerX + radius)) + 1;
  const minY = Math.floor(pixelY(centerY + radius));
  const maxY = Math.floor(pixelY(centerY - radius)) + 1;
  if (minX < 0 || minY < 0 || maxX >= m.width || maxY >= m.height) {
    throw new TerrainError('Observer and search circle exceed prepared polar pixels.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  const keys: string[] = [];
  for (let row = Math.floor(minY / m.tileSize); row <= Math.floor(maxY / m.tileSize); row++) {
    for (let column = Math.floor(minX / m.tileSize); column <= Math.floor(maxX / m.tileSize); column++) {
      keys.push(`${column}-${row}.bin`);
    }
  }
  const { tiles, loadedBytes } = await loadTiles(m, keys, fetchAsset, directory);
  function value(column: number, row: number): number {
    if (column < 0 || row < 0 || column >= m.width || row >= m.height) {
      throw new TerrainError('A polar sample lies outside prepared pixels.', 'TERRAIN_OUT_OF_COVERAGE', 422);
    }
    const tile = tiles.get(`${Math.floor(column / m.tileSize)}-${Math.floor(row / m.tileSize)}.bin`);
    const raw = tile?.getInt16(((row % m.tileSize) * m.tileSize + column % m.tileSize) * 2, true);
    if (raw === undefined || raw === m.noData) {
      throw new TerrainError('A required polar terrain height is missing.', 'TERRAIN_MISSING_DATA', 422);
    }
    return raw * m.heightScaleM;
  }
  return {
    manifest: m, referenceRadiusM: m.referenceRadiusM,
    // Stereographic scale grows away from the pole. Use the smallest physical
    // cell spacing in the search circle for the shared ray sampler.
    resolutionM: m.pixelSizeM * Math.cos((colatitude + angularDistance) / 2) ** 2,
    loadedTileCount: tiles.size, loadedBytes,
    sample(latitude, longitude) {
      if (sign * latitude < edgeLatitude) {
        throw new TerrainError('A sample exceeds polar latitude coverage.', 'TERRAIN_OUT_OF_COVERAGE', 422);
      }
      const point = projectPolar(latitude, longitude, m.pole, m.referenceRadiusM);
      const px = pixelX(point.x), py = pixelY(point.y);
      const column = Math.floor(px), row = Math.floor(py), a = px - column, b = py - row;
      return (value(column, row) * (1 - a) + value(column + 1, row) * a) * (1 - b)
        + (value(column, row + 1) * (1 - a) + value(column + 1, row + 1) * a) * b;
    },
  };
}
