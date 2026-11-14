/** Terrain uses planetocentric latitude and east-positive longitude in MOON_ME DE421. */
export interface MoonQuery {
  longitude: number;
  latitude: number;
  eyeHeightM: number;
  azimuthStepDeg: number;
  maxDistanceM: number;
}

export interface TerrainManifest {
  format: 'lunar-dem-f32-v1';
  id: string;
  source: string;
  sourceUrl: string;
  sourceProduct: string;
  sourceVersion: string;
  referenceFrame: 'MOON_ME_DE421';
  referenceRadiusM: number;
  projection: 'simple-cylindrical';
  registration: 'pixel-center';
  heightUnit: 'meter';
  encoding: 'float32-le';
  noData: 'NaN';
  pixelsPerDegree: number;
  tileSize: number;
  northDeg: number;
  southDeg: number;
  westDeg: number;
  eastDeg: number;
  /** SHA-256 of each prepared tile, keyed by "column-row.bin". */
  tiles: Record<string, string>;
  preparation: { sourceLabelSha256: string; sourceRangesSha256: string[] };
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
    terrain: TerrainManifest;
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
    };
  };
}
