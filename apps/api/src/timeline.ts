import type { Hono } from 'hono';
import type { TimelineEphemerisQuery, TimelinePositions, TimelineResponse } from '@lunar-lense/contracts';
import { parseTimelineQuery } from './timeline-query.js';
import type { AssetFetcher } from './terrain/loader.js';
import { terrainVisibility } from './terrain/profile.js';
import { getMoonProfile, terrainAssetFetcher, type TerrainBindings } from './terrain/service.js';

export type GetTimeline = (query: TimelineEphemerisQuery) => Promise<TimelinePositions>;

export function timelineCsv(response: TimelineResponse): string {
  const header = [
    'timestamp', 'timeScale', 'longitudeDeg', 'latitudeDeg', 'altitudeKm', 'visibilityModel',
    'earthAzimuthDeg', 'earthElevationDeg', 'earthIsVisible',
    'sunAzimuthDeg', 'sunElevationDeg', 'sunIsVisible',
    'groundElevationM', 'eyeHeightM', 'terrainDatasetId', 'terrainReferenceFrame',
    'azimuthStepDeg', 'maxDistanceM', 'earthTerrainHorizonElevationDeg', 'sunTerrainHorizonElevationDeg',
  ];
  const { observer, positions, moon } = response;
  const escape = (value: string | number | boolean) => {
    const raw = String(value);
    return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
  };
  const rows = positions.earth.map((earth, index) => {
    const sun = positions.sun[index]!;
    return [
      earth.timestamp, response.timeScale, observer.longitudeDeg, observer.latitudeDeg,
      observer.altitudeKm, response.visibilityModel,
      earth.azimuthDeg, earth.elevationDeg, earth.isVisible,
      sun.azimuthDeg, sun.elevationDeg, sun.isVisible,
      observer.groundElevationM, observer.eyeHeightM, moon.terrain.id, moon.terrain.referenceFrame,
      moon.calculation.azimuthStepDeg, moon.calculation.maxDistanceM,
      earth.terrainHorizonElevationDeg, sun.terrainHorizonElevationDeg,
    ].map(escape).join(',');
  });
  return [header.join(','), ...rows, ''].join('\r\n');
}

export function registerTimelineRoute(
  app: Hono<{ Bindings: TerrainBindings }>, getTimeline: GetTimeline, fetchAsset?: AssetFetcher,
): void {
  app.get('/api/timeline', async (c) => {
    const { query, format } = parseTimelineQuery(new URL(c.req.url).searchParams);
    // Load and calculate once. Both this endpoint and /api/moon use the same service.
    const profile = await getMoonProfile(query, fetchAsset ?? terrainAssetFetcher(c.env, c.req.url));
    const rawPositions = await getTimeline({
      start: query.start, end: query.end, stepMinutes: query.stepMinutes,
      longitude: profile.observer.longitudeDeg, latitude: profile.observer.latitudeDeg,
      altitudeKm: profile.observer.altitudeKm,
    });
    const applyVisibility = (positions: TimelinePositions['earth']) => positions.map(position => ({
      ...position, ...terrainVisibility(profile.moon.horizon, position),
    }));
    const positions = {
      earth: applyVisibility(rawPositions.earth),
      sun: applyVisibility(rawPositions.sun),
    };
    const response: TimelineResponse = {
      timeScale: 'UTC',
      range: {
        start: query.start,
        end: query.end,
        stepMinutes: query.stepMinutes,
        sampleCount: positions.earth.length,
      },
      observer: profile.observer,
      moon: profile.moon,
      visibilityModel: 'terrain',
      positions,
      source: 'NASA/JPL Horizons',
    };
    if (format === 'csv') {
      const filename = `lunar-lense-timeline-${query.start.slice(0, 10)}-${query.end.slice(0, 10)}.csv`;
      return new Response(timelineCsv(response), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }
    return c.json(response);
  });
}
