import { createHash } from 'node:crypto';
import type { GlobalTerrainManifest } from '@lunar-lense/contracts';
import type { AssetFetcher } from '../../src/terrain/loader.js';

/** Real global dimensions, shared constant tiles, optional small synthetic region. */
export function globalAssets(height?: (lat: number, lon: number, ppd: number) => number,
  region = { north: -8, south: -12, west: 21, east: 25 }, baseline = 100) {
  const files = new Map<string, Uint8Array>();
  const manifests: Record<number, GlobalTerrainManifest> = {};
  const constant = new Uint8Array(256 * 256 * 2);
  const view = new DataView(constant.buffer);
  for (let i = 0; i < 256 * 256; i++) view.setInt16(i * 2, baseline * 2, true);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const constantHash = hash(constant);
  for (const ppd of [64, 16]) {
    const directory = `/terrain/ldem_${ppd}`;
    const m: GlobalTerrainManifest = {
      format: 'lunar-dem-i16-v1', id: `lola-global-${ppd}`, source: 'synthetic',
      sourceProduct: `LDEM_${ppd}`, sourceVersion: 'V3.1', sourceUrl: `https://example.com/ldem_${ppd}.img`,
      referenceFrame: 'MOON_ME_DE421', referenceRadiusM: 1737400,
      projection: 'simple-cylindrical', registration: 'pixel-center', heightUnit: 'meter',
      encoding: 'int16-le', heightScaleM: 0.5, noData: -32768, pixelsPerDegree: ppd,
      width: 360 * ppd, height: 180 * ppd, tileSize: 256,
      northDeg: 90, southDeg: -90, westDeg: 0, eastDeg: 360,
      tiles: {}, preparation: { sourceLabelSha256: '0'.repeat(64), sourceRangesSha256: [], sourceImageSha256: '0'.repeat(64) },
    };
    for (let row = 0; row < Math.ceil(m.height / 256); row++) for (let col = 0; col < Math.ceil(m.width / 256); col++) {
      const name = `${col}-${row}.bin`;
      let bytes = constant;
      if (height && 90 - row * 256 / ppd >= region.south && 90 - (row + 1) * 256 / ppd <= region.north
        && col * 256 / ppd <= region.east && (col + 1) * 256 / ppd >= region.west) {
        bytes = new Uint8Array(constant.length);
        const tile = new DataView(bytes.buffer);
        for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
          const z = height(90 - (row * 256 + y + 0.5) / ppd, (col * 256 + x + 0.5) / ppd, ppd);
          tile.setInt16((y * 256 + x) * 2, Number.isFinite(z) ? Math.round(z * 2) : -32768, true);
        }
      }
      files.set(`${directory}/${name}`, bytes);
      m.tiles[name] = bytes === constant ? constantHash : hash(bytes);
    }
    manifests[ppd] = m;
  }
  const requested: string[] = [];
  const fetcher: AssetFetcher = async path => {
    requested.push(path);
    const level = /^\/terrain\/ldem_(16|64)\/manifest.json$/.exec(path);
    if (level) return Response.json(manifests[Number(level[1])]);
    const bytes = files.get(path);
    return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
  };
  return { files, manifests, requested, fetcher };
}
