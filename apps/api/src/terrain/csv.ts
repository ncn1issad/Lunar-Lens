import type { MoonResponse } from '@lunar-lense/contracts';

export function moonCsv(response: MoonResponse): string {
  const { observer, moon } = response;
  const { terrain, calculation } = moon;
  const header = [
    'azimuthDeg', 'terrainHorizonElevationDeg', 'peakDistanceM',
    'longitudeDeg', 'latitudeDeg', 'groundElevationM', 'eyeHeightM', 'altitudeKm',
    'terrainId', 'sourceProduct', 'sourceVersion', 'sourceUrl', 'referenceFrame', 'referenceRadiusM',
    'pixelsPerDegree', 'azimuthStepDeg', 'maxDistanceM', 'firstDistanceM', 'distanceStepM', 'samplesPerAzimuth',
    'projection', 'pixelSizeM',
    'nearSourceProduct', 'nearMaxDistanceM', 'nearPixelsPerDegree', 'farSourceProduct', 'farPixelsPerDegree', 'farDistanceStepM',
  ];
  const metadata = [
    observer.longitudeDeg, observer.latitudeDeg, observer.groundElevationM, observer.eyeHeightM, observer.altitudeKm,
    terrain.id, terrain.sourceProduct, terrain.sourceVersion, terrain.sourceUrl, terrain.referenceFrame, terrain.referenceRadiusM,
    'pixelsPerDegree' in terrain ? terrain.pixelsPerDegree : '', calculation.azimuthStepDeg, calculation.maxDistanceM,
    calculation.firstDistanceM, calculation.distanceStepM, calculation.samplesPerAzimuth,
    terrain.projection, terrain.projection === 'polar-stereographic' ? terrain.pixelSizeM : '',
    ...('layers' in terrain ? [
      terrain.layers[0]?.sourceProduct ?? '', terrain.layers[0]?.maxDistanceM ?? '', terrain.layers[0]?.pixelsPerDegree ?? '',
      terrain.layers[1]?.sourceProduct ?? '', terrain.layers[1]?.pixelsPerDegree ?? '', terrain.layers[1]?.distanceStepM ?? '',
    ] : ['', '', '', '', '', '']),
  ];
  const escape = (value: number | string) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = moon.horizon.map(sample => [sample.azimuthDeg, sample.elevationDeg, sample.distanceM, ...metadata]
    .map(escape).join(','));
  return [header.join(','), ...rows, ''].join('\r\n');
}
