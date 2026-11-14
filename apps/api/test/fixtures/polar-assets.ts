import { createHash } from 'node:crypto';
import type { PolarTerrainManifest } from '@lunar-lense/contracts';
import type { AssetFetcher } from '../../src/terrain/loader.js';

export function polarAssets(pole: 'north' | 'south', height: (x: number, y: number) => number = () => 100.5) {
  const directory = `/terrain/${pole}`;
  const manifest: PolarTerrainManifest = {
    format: 'lunar-dem-i16-v1', id: `synthetic-${pole}`, source: 'synthetic',
    sourceUrl: 'https://example.com/polar.img', sourceProduct: 'test', sourceVersion: '1',
    referenceFrame: 'MOON_ME_DE421', referenceRadiusM: 1737400,
    projection: 'polar-stereographic', pole, centralLongitudeDeg: 0,
    registration: 'pixel-center', heightUnit: 'meter', encoding: 'int16-le', heightScaleM: 0.5, noData: -32768,
    pixelSizeM: 80, width: 128, height: 128, originXM: -5120, originYM: 5120, tileSize: 16,
    northDeg: pole === 'north' ? 90 : -80, southDeg: pole === 'north' ? 80 : -90,
    westDeg: 0, eastDeg: 360, tiles: {},
    preparation: { sourceLabelSha256: '0'.repeat(64), sourceImageSha256: '0'.repeat(64), sourceRangesSha256: [] },
  };
  const files = new Map<string, Uint8Array>();
  for (let row = 0; row < 8; row++) for (let column = 0; column < 8; column++) {
    const bytes = new Uint8Array(16 * 16 * 2);
    const view = new DataView(bytes.buffer);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const value = height(-5120 + (column * 16 + x + 0.5) * 80, 5120 - (row * 16 + y + 0.5) * 80);
      view.setInt16((y * 16 + x) * 2, Number.isNaN(value) ? -32768 : Math.round(value * 2), true);
    }
    const name = `${column}-${row}.bin`;
    files.set(`${directory}/${name}`, bytes);
    manifest.tiles[name] = createHash('sha256').update(bytes).digest('hex');
  }
  const requested: string[] = [];
  const fetcher: AssetFetcher = async path => {
    requested.push(path);
    if (path === `${directory}/manifest.json`) return Response.json(manifest);
    const bytes = files.get(path);
    return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
  };
  return { manifest, files, fetcher, requested };
}
