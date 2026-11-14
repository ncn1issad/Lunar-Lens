import type { MoonQuery, MoonResponse } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import type { AssetFetcher } from './loader.js';
import { loadGlobalTerrain } from './global.js';
import { buildMoonProfile } from './profile.js';

export interface TerrainBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export function terrainAssetFetcher(bindings: TerrainBindings | undefined, requestUrl: string): AssetFetcher {
  return async path => {
    if (!bindings?.ASSETS) throw new TerrainError('Terrain asset binding is unavailable.', 'TERRAIN_UNAVAILABLE', 503);
    return bindings.ASSETS.fetch(new Request(new URL(path, requestUrl)));
  };
}

/** Shared by /api/moon and /api/timeline, without an HTTP call between routes. */
export async function getMoonProfile(query: MoonQuery, fetchAsset: AssetFetcher): Promise<MoonResponse> {
  return buildMoonProfile(query, await loadGlobalTerrain(query, fetchAsset));
}
