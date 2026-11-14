import type { MoonQuery, MoonResponse, TerrainHorizonSample } from '@lunar-lense/contracts';
import { TerrainError } from './errors.js';
import { apparentElevationDeg, normalizeLongitude } from './geometry.js';
import type { LoadedTerrain, TerrainSurface } from './loader.js';

export function calculateSkyline(query: MoonQuery, terrain: TerrainSurface) {
  const groundElevationM = terrain.sample(query.latitude, normalizeLongitude(query.longitude));
  const observerHeightM = groundElevationM + query.eyeHeightM;
  if (!Number.isFinite(groundElevationM) || !Number.isFinite(terrain.resolutionM) || terrain.resolutionM <= 0) {
    throw new TerrainError('Invalid observer ground height or terrain resolution.', 'TERRAIN_MISSING_DATA', 422);
  }
  // Each LOD has its own radial step. Include the transition and final endpoint.
  const distanceStepM = terrain.resolutionM / 2;
  const firstDistanceM = Math.min(1, distanceStepM);
  const distances = [firstDistanceM];
  const bands = terrain.samplingBands ?? [{ startM: 0, endM: query.maxDistanceM, stepM: distanceStepM }];
  for (const band of bands) {
    if (!Number.isFinite(band.stepM) || band.stepM <= 0) throw new TerrainError('Invalid terrain sampling step.', 'TERRAIN_MISSING_DATA', 422);
    for (let d = band.startM + band.stepM; d < band.endM; d += band.stepM) {
      if (d > firstDistanceM) distances.push(d);
      if (distances.length * (360 / query.azimuthStepDeg) > 3_000_000) {
        throw new TerrainError('Calculation exceeds three million terrain samples. Reduce distance or azimuth resolution.', 'TERRAIN_OUT_OF_COVERAGE', 422);
      }
    }
    distances.push(band.endM);
  }
  if (distances.length * (360 / query.azimuthStepDeg) > 3_000_000) {
    throw new TerrainError('Calculation exceeds three million terrain samples. Reduce distance or azimuth resolution.', 'TERRAIN_OUT_OF_COVERAGE', 422);
  }
  const DEG = Math.PI / 180, radius = terrain.referenceRadiusM;
  const sinLat = Math.sin(query.latitude * DEG), cosLat = Math.cos(query.latitude * DEG);
  const steps = distances.map(distanceM => {
    const angle = distanceM / radius;
    return { distanceM, sin: Math.sin(angle), cos: Math.cos(angle), drop: 2 * Math.sin(angle / 2) ** 2 };
  });
  const horizon: TerrainHorizonSample[] = [];
  for (let ray = 0; ray < 360 / query.azimuthStepDeg; ray++) {
    const azimuthDeg = ray * query.azimuthStepDeg;
    const cosAz = Math.cos(azimuthDeg * DEG), sinAz = Math.sin(azimuthDeg * DEG);
    let peak = -90, peakDistance = firstDistanceM;
    for (const step of steps) {
      const { distanceM } = step;
      // Work in the observer's meridian, then rotate longitude. Precomputed
      // distance/latitude trigonometry is shared by all 2,880 default directions.
      const x = step.cos * cosLat - cosAz * step.sin * sinLat;
      const y = sinAz * step.sin;
      const z = step.cos * sinLat + cosAz * step.sin * cosLat;
      const latitude = Math.atan2(z, Math.hypot(x, y)) / DEG;
      const longitude = normalizeLongitude(query.longitude + Math.atan2(y, x) / DEG);
      const heightM = terrain.sample(latitude, longitude, distanceM);
      if (!Number.isFinite(heightM)) {
        throw new TerrainError('A required terrain sample is missing.', 'TERRAIN_MISSING_DATA', 422);
      }
      const elevation = Math.atan2(heightM - observerHeightM - (radius + heightM) * step.drop,
        (radius + heightM) * step.sin) / DEG;
      if (elevation > peak) { peak = elevation; peakDistance = distanceM; }
    }
    horizon.push({ azimuthDeg, elevationDeg: peak, distanceM: peakDistance });
  }
  let farCellCount = 0;
  terrain.visitFarCells?.(cell => {
    if (++farCellCount > 2_000_000) throw new TerrainError('Far field exceeds two million cells.', 'TERRAIN_OUT_OF_COVERAGE', 422);
    // For a fixed height below the observer, elevation reaches its maximum at
    // acos(targetRadius / observerRadius). Otherwise the nearest point wins.
    const tangentDistance = cell.heightM < observerHeightM
      ? radius * Math.acos((radius + cell.heightM) / (radius + observerHeightM)) : 0;
    const distanceM = Math.max(cell.minDistanceM, Math.min(cell.maxDistanceM, tangentDistance));
    const elevation = apparentElevationDeg(distanceM, cell.heightM, observerHeightM, radius);
    const left = Math.floor((cell.azimuthDeg - cell.angularRadiusDeg) / query.azimuthStepDeg);
    const right = Math.ceil((cell.azimuthDeg + cell.angularRadiusDeg) / query.azimuthStepDeg);
    // Promote both bounding rays so periodic interpolation also covers every
    // direction inside the cell. This intentionally overestimates its outline.
    for (let index = left; index <= right; index++) {
      const row = horizon[((index % horizon.length) + horizon.length) % horizon.length]!;
      if (elevation > row.elevationDeg) { row.elevationDeg = elevation; row.distanceM = distanceM; }
    }
  });
  return { groundElevationM, horizon, firstDistanceM, distanceStepM, samplesPerAzimuth: distances.length, farCellCount };
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
        ...(terrain.visitFarCells ? { farFieldCoverage: 'cell-envelope' as const, farCellCount: profile.farCellCount } : {}),
      },
    },
  };
}
