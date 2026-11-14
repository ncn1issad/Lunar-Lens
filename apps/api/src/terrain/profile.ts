import type { MoonQuery, MoonResponse, TerrainHorizonSample } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import { apparentElevationDeg, destination, normalizeLongitude } from './geometry.js';
import type { LoadedTerrain, TerrainSurface } from './loader.js';

export function calculateSkyline(query: MoonQuery, terrain: TerrainSurface) {
  const groundElevationM = terrain.sample(query.latitude, normalizeLongitude(query.longitude));
  const observerHeightM = groundElevationM + query.eyeHeightM;
  if (!Number.isFinite(groundElevationM) || !Number.isFinite(terrain.resolutionM) || terrain.resolutionM <= 0) {
    throw new TerrainError('Invalid observer ground height or terrain resolution.', 'TERRAIN_MISSING_DATA', 422);
  }
  // Half a grid cell along the whole ray, including the far field. This avoids
  // assuming that distant peaks cannot matter. Azimuth gaps still limit accuracy.
  const distanceStepM = terrain.resolutionM / 2;
  const firstDistanceM = Math.min(1, distanceStepM);
  const distances = [firstDistanceM];
  for (let d = distanceStepM; d < query.maxDistanceM; d += distanceStepM) {
    if (d > firstDistanceM) distances.push(d);
    if (distances.length * (360 / query.azimuthStepDeg) > 2_000_000) {
      throw new TerrainError('Calculation exceeds two million terrain samples. Reduce distance or azimuth resolution.', 'TERRAIN_OUT_OF_COVERAGE', 422);
    }
  }
  distances.push(query.maxDistanceM);
  if (distances.length * (360 / query.azimuthStepDeg) > 2_000_000) {
    throw new TerrainError('Calculation exceeds two million terrain samples. Reduce distance or azimuth resolution.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  const horizon: TerrainHorizonSample[] = [];
  for (let ray = 0; ray < 360 / query.azimuthStepDeg; ray++) {
    const azimuthDeg = ray * query.azimuthStepDeg;
    let peak = -90, peakDistance = firstDistanceM;
    for (const distanceM of distances) {
      const p = destination(query.latitude, query.longitude, azimuthDeg, distanceM, terrain.referenceRadiusM);
      const heightM = terrain.sample(p.latitude, p.longitude);
      if (!Number.isFinite(heightM)) {
        throw new TerrainError('A required terrain sample is missing.', 'TERRAIN_MISSING_DATA', 422);
      }
      const elevation = apparentElevationDeg(distanceM, heightM, observerHeightM, terrain.referenceRadiusM);
      if (elevation > peak) { peak = elevation; peakDistance = distanceM; }
    }
    horizon.push({ azimuthDeg, elevationDeg: peak, distanceM: peakDistance });
  }
  return { groundElevationM, horizon, firstDistanceM, distanceStepM, samplesPerAzimuth: distances.length };
}

/** The input is a complete, ordered, uniformly spaced profile starting at north. */
export function interpolateSkyline(horizon: readonly TerrainHorizonSample[], azimuthDeg: number): number {
  if (horizon.length < 2 || !Number.isFinite(azimuthDeg)) throw new Error('Invalid skyline or azimuth.');
  const index = normalizeLongitude(azimuthDeg) / 360 * horizon.length;
  const left = Math.floor(index), fraction = index - left;
  return horizon[left]!.elevationDeg * (1 - fraction)
    + horizon[(left + 1) % horizon.length]!.elevationDeg * fraction;
}

/** Reuse this for every timestamp and export. Below-zero terrain horizons are valid. */
export function terrainVisibility(
  horizon: readonly TerrainHorizonSample[], position: { azimuthDeg: number; elevationDeg: number },
): { terrainHorizonElevationDeg: number; isVisible: boolean } {
  const terrainHorizonElevationDeg = interpolateSkyline(horizon, position.azimuthDeg);
  return { terrainHorizonElevationDeg, isVisible: position.elevationDeg >= terrainHorizonElevationDeg };
}

export function buildMoonProfile(query: MoonQuery, terrain: LoadedTerrain): MoonResponse {
  const profile = calculateSkyline(query, terrain);
  return {
    observer: {
      body: 'moon', longitudeDeg: normalizeLongitude(query.longitude), latitudeDeg: query.latitude,
      groundElevationM: profile.groundElevationM, eyeHeightM: query.eyeHeightM,
      altitudeKm: (profile.groundElevationM + query.eyeHeightM) / 1000,
    },
    moon: {
      horizon: profile.horizon, terrain: terrain.manifest,
      calculation: {
        azimuthStepDeg: query.azimuthStepDeg, maxDistanceM: query.maxDistanceM,
        firstDistanceM: profile.firstDistanceM, distanceStepM: profile.distanceStepM,
        samplesPerAzimuth: profile.samplesPerAzimuth,
        heightInterpolation: 'bilinear', horizonInterpolation: 'linear-periodic',
        visibility: 'body-center', searchLimit: 'fixed-distance',
        loadedTileCount: terrain.loadedTileCount, loadedBytes: terrain.loadedBytes,
      },
    },
  };
}
