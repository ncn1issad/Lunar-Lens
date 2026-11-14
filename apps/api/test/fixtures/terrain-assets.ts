import { createHash } from 'node:crypto';
import type { TerrainManifest } from '@lunar-lense/contracts';
import type { AssetFetcher } from '../../src/terrain/loader.js';

/** Small synthetic DEM around the coordinates used by the captured Horizons fixtures. */
export function terrainAssets(height: (latitude: number, longitude: number) => number = () => 100) {
  const files = new Map<string, Uint8Array>();
  const manifest: TerrainManifest = {
    format: 'lunar-dem-f32-v1', id: 'synthetic-timeline-terrain',
    source: 'synthetic test data', sourceUrl: 'https://example.com/terrain',
    sourceProduct: 'test', sourceVersion: '1', referenceFrame: 'MOON_ME_DE421',
    referenceRadiusM: 1737400, projection: 'simple-cylindrical', registration: 'pixel-center',
    heightUnit: 'meter', encoding: 'float32-le', noData: 'NaN', pixelsPerDegree: 4, tileSize: 4,
    northDeg: -8, southDeg: -12, westDeg: 21, eastDeg: 25,
    tiles: {}, preparation: { sourceLabelSha256: '0'.repeat(64), sourceRangesSha256: [] },
  };
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      view.setFloat32((y * 4 + x) * 4, height(
        -8 - (row * 4 + y + 0.5) / 4,
        21 + (column * 4 + x + 0.5) / 4,
      ), true);
    }
    const name = `${column}-${row}.bin`;
    manifest.tiles[name] = createHash('sha256').update(bytes).digest('hex');
    files.set(`/terrain/${name}`, bytes);
  }
  const requested: string[] = [];
  const fetcher: AssetFetcher = async path => {
    requested.push(path);
    if (path === '/terrain/manifest.json') return Response.json(manifest);
    const bytes = files.get(path);
    return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
  };
  return { fetcher, requested, files, manifest };
}
