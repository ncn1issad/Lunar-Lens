import type { TerrainManifest } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import type { AssetFetcher } from './loader.js';

export async function loadTiles(
  manifest: TerrainManifest, keys: readonly string[], fetchAsset: AssetFetcher, directory: string,
): Promise<{ tiles: Map<string, DataView>; loadedBytes: number }> {
  const bytesPerValue = manifest.encoding === 'int16-le' ? 2 : 4;
  const byteLength = manifest.tileSize ** 2 * bytesPerValue;
  if (keys.length * byteLength > 48 * 1024 * 1024) {
    throw new TerrainError('Search area needs more than the 48 MiB terrain budget. Reduce maxDistanceM.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  const tiles = new Map<string, DataView>();
  for (const key of keys) {
    const hash = manifest.tiles[key];
    if (!hash) throw new TerrainError(`Prepared terrain tile ${key} is absent from the manifest.`, 'TERRAIN_UNAVAILABLE', 503);
    try {
      const response = await fetchAsset(`${directory}/${key}`);
      if (!response.ok) throw new Error('download failed');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== byteLength) {
        throw new TerrainError(`Terrain tile ${key} has an invalid size.`, 'TERRAIN_UNAVAILABLE', 503);
      }
      const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (actual !== hash) {
        throw new TerrainError(`Terrain tile ${key} failed its integrity check.`, 'TERRAIN_UNAVAILABLE', 503);
      }
      tiles.set(key, new DataView(buffer));
    } catch (error) {
      if (error instanceof TerrainError) throw error;
      throw new TerrainError(`Cannot load terrain tile ${key}.`, 'TERRAIN_UNAVAILABLE', 503);
    }
  }
  return { tiles, loadedBytes: keys.length * byteLength };
}
