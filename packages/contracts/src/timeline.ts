import type { Position } from './index.js';
import type { MoonQuery, MoonResponse } from './terrain.js';

export interface TimelineQuery extends MoonQuery {
  /** UTC timestamps normalized to YYYY-MM-DDTHH:mm:ssZ. */
  start: string;
  end: string;
  stepMinutes: number;
}

/** Internal Horizons input. Altitude comes from the computed terrain observer. */
export interface TimelineEphemerisQuery extends Pick<TimelineQuery, 'start' | 'end' | 'stepMinutes' | 'longitude' | 'latitude'> {
  /** Height above the lunar reference sphere, not eye height above terrain. */
  altitudeKm: number;
}

export interface TimedPosition extends Position {
  timestamp: string;
}

export interface TimelinePositions {
  earth: TimedPosition[];
  sun: TimedPosition[];
}

export interface TerrainTimedPosition extends TimedPosition {
  terrainHorizonElevationDeg: number;
}

export interface TerrainTimelinePositions {
  earth: TerrainTimedPosition[];
  sun: TerrainTimedPosition[];
}

export interface TimelineResponse {
  timeScale: 'UTC';
  range: {
    start: string;
    end: string;
    stepMinutes: number;
    sampleCount: number;
  };
  observer: MoonResponse['observer'];
  moon: MoonResponse['moon'];
  /** Body center on or above the interpolated terrain skyline at its azimuth. */
  visibilityModel: 'terrain';
  positions: TerrainTimelinePositions;
  source: 'NASA/JPL Horizons';
}
