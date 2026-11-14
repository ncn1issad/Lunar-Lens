import type { TimelineQuery } from '@lunar-lense/contracts';
import { InvalidInputError } from './validation.js';
import { parseMoonQuery } from './terrain/routes.js';

export const MAX_TIMELINE_DAYS = 366;
export const MAX_TIMELINE_SAMPLES = 10_000;
const MAX_STEP_MINUTES = MAX_TIMELINE_DAYS * 24 * 60;

export function timelineSampleCount(query: Pick<TimelineQuery, 'start' | 'end' | 'stepMinutes'>): number {
  return Math.floor((Date.parse(query.end) - Date.parse(query.start)) / (query.stepMinutes * 60_000)) + 1;
}

export function parseTimelineQuery(params: URLSearchParams): {
  query: TimelineQuery;
  format: 'json' | 'csv';
} {
  const required = ['start', 'end', 'longitude', 'latitude'];
  const terrainKeys = ['longitude', 'latitude', 'eyeHeightM', 'azimuthStepDeg', 'maxDistanceM'];
  const allowed = ['start', 'end', 'stepMinutes', 'format', ...terrainKeys];
  if (params.has('altitudeKm')) {
    throw new InvalidInputError('altitudeKm is derived from terrain ground elevation plus eyeHeightM. Use eyeHeightM to set observer height above ground.');
  }
  if ([...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)
    || required.some((key) => params.getAll(key).length !== 1)) {
    throw new InvalidInputError('Provide start, end, longitude and latitude exactly once, with no unknown or repeated parameters.');
  }

  function timestamp(key: string): string {
    const raw = params.get(key)!;
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
    const date = new Date(normalized);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(normalized)
      || !Number.isFinite(date.getTime())
      || date.toISOString().replace('.000Z', 'Z') !== normalized
      || normalized < '1962-01-01T00:00:00Z' || normalized >= '2650-01-01T00:00:00Z') {
      throw new InvalidInputError(`${key} must be a valid YYYY-MM-DD date or YYYY-MM-DDTHH:mm:ssZ UTC timestamp, in years 1962 through 2649, within the supported lunar mean-Earth frame interval.`);
    }
    return normalized;
  }

  function number(key: string, min: number, max: number, fallback?: number): number {
    const raw = params.get(key);
    if (raw === null && fallback !== undefined) return fallback;
    const value = Number(raw?.trim());
    if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim())
      || !Number.isFinite(value) || value < min || value > max) {
      throw new InvalidInputError(`${key} must be a finite number between ${min} and ${max}.`);
    }
    return value;
  }

  const query: TimelineQuery = {
    start: timestamp('start'),
    end: timestamp('end'),
    ...parseMoonQuery(new URLSearchParams([...params].filter(([key]) => terrainKeys.includes(key)))),
    stepMinutes: number('stepMinutes', 1, MAX_STEP_MINUTES, 60),
  };
  if (!Number.isInteger(query.stepMinutes)) {
    throw new InvalidInputError('stepMinutes must be a whole number of minutes.');
  }
  const duration = Date.parse(query.end) - Date.parse(query.start);
  if (duration <= 0 || duration > MAX_TIMELINE_DAYS * 86_400_000) {
    throw new InvalidInputError(`end must be after start, with a range of at most ${MAX_TIMELINE_DAYS} days.`);
  }
  if (timelineSampleCount(query) > MAX_TIMELINE_SAMPLES) {
    throw new InvalidInputError(`Request at most ${MAX_TIMELINE_SAMPLES} samples per body; shorten the range or increase stepMinutes.`);
  }
  const format = params.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    throw new InvalidInputError('format must be json or csv.');
  }
  return { query, format };
}
