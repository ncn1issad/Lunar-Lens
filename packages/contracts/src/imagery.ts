/** Geographic XYZ imagery; polar and irregular matrices need separate contracts. */
export interface GeographicImageryLayer {
  id: string;
  source: string;
  sourceLayer: string;
  projection: 'equirectangular';
  nativeCrs: string;
  longitudeConvention: 'east-positive';
  boundsDeg: { west: number; south: number; east: number; north: number };
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  matrixSet: string;
  scheme: 'xyz';
  levelZeroColumns: number;
  levelZeroRows: number;
  contentType: 'image/jpeg';
  tileUrlTemplate: string;
  appearance: 'photographic';
  credit: string;
}
