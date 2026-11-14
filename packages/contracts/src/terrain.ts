/** Terrain uses planetocentric latitude and east-positive longitude in MOON_ME DE421. */
export interface MoonQuery {
  longitude: number;
  latitude: number;
  eyeHeightM: number;
  azimuthStepDeg: number;
  maxDistanceM: number;
}

interface TerrainManifestBase {
  id: string;
  source: string;
  sourceUrl: string;
  sourceProduct: string;
  sourceVersion: string;
  referenceFrame: 'MOON_ME_DE421';
  referenceRadiusM: number;
  registration: 'pixel-center';
  heightUnit: 'meter';
  tileSize: number;
  northDeg: number;
  southDeg: number;
  westDeg: number;
  eastDeg: number;
  /** SHA-256 of each prepared tile, keyed by "column-row.bin". */
  tiles: Record<string, string>;
  preparation: {
    sourceLabelSha256: string;
    sourceRangesSha256: string[];
    sourceImageSha256?: string;
    sourceNoDataCount?: number;
  };
}

export interface CylindricalTerrainManifest extends TerrainManifestBase {
  format: 'lunar-dem-f32-v1';
  projection: 'simple-cylindrical';
  encoding: 'float32-le';
  noData: 'NaN';
  pixelsPerDegree: number;
}

export interface PolarTerrainManifest extends TerrainManifestBase {
  format: 'lunar-dem-i16-v1';
  projection: 'polar-stereographic';
  encoding: 'int16-le';
  noData: -32768;
  heightScaleM: 0.5;
  pole: 'north' | 'south';
  centralLongitudeDeg: 0;
  pixelSizeM: number;
  width: number;
  height: number;
  /** Projected X/Y of the upper-left pixel's outer corner, in metres. */
  originXM: number;
  originYM: number;
}

export interface GlobalTerrainManifest extends TerrainManifestBase {
  format: 'lunar-dem-i16-v1';
  projection: 'simple-cylindrical';
  encoding: 'int16-le';
  noData: -32768;
  heightScaleM: 0.5;
  pixelsPerDegree: number;
  width: number;
  height: number;
}

export type TerrainManifest = CylindricalTerrainManifest | PolarTerrainManifest | GlobalTerrainManifest;

/** Both calculation sources; full tile indices stay in the static asset manifests. */
export interface TerrainLodMetadata {
  format: 'lunar-dem-lod-v1';
  id: string;
  source: string;
  sourceProduct: string;
  sourceVersion: string;
  sourceUrl: string;
  referenceFrame: 'MOON_ME_DE421';
  referenceRadiusM: number;
  projection: 'simple-cylindrical';
  layers: (Omit<GlobalTerrainManifest, 'tiles'> & {
    minDistanceM: number;
    maxDistanceM: number;
    distanceStepM: number;
    loadedTileCount: number;
    loadedBytes: number;
  })[];
}

export interface TerrainHorizonSample {
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
}

export interface MoonResponse {
  observer: {
    body: 'moon';
    longitudeDeg: number;
    latitudeDeg: number;
    groundElevationM: number;
    eyeHeightM: number;
    /** Ground plus eye height above the 1737.4 km MOON_ME_DE421 reference sphere. */
    altitudeKm: number;
  };
  moon: {
    horizon: TerrainHorizonSample[];
    terrain: TerrainManifest | TerrainLodMetadata;
    calculation: {
      azimuthStepDeg: number;
      maxDistanceM: number;
      firstDistanceM: number;
      distanceStepM: number;
      samplesPerAzimuth: number;
      heightInterpolation: 'bilinear';
      horizonInterpolation: 'linear-periodic';
      visibility: 'body-center';
      searchLimit: 'fixed-distance';
      loadedTileCount: number;
      loadedBytes: number;
      farFieldCoverage?: 'cell-envelope';
      farCellCount?: number;
    };
  };
}
