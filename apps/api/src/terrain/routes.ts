import { Hono } from 'hono';
import type { MoonQuery } from '@lunar-lense/contracts';
import { InvalidInputError } from '../validation.js';
import { TerrainError } from './errors.js';
import type { AssetFetcher } from './loader.js';
import { getMoonProfile, terrainAssetFetcher, type TerrainBindings } from './service.js';
import { moonCsv } from './csv.js';

export type { TerrainBindings } from './service.js';

export function parseMoonQuery(params: URLSearchParams): MoonQuery {
  const keys = ['longitude', 'latitude', 'eyeHeightM', 'azimuthStepDeg', 'maxDistanceM', 'format'];
  if ([...params.keys()].some(key => !keys.includes(key))
    || ['longitude', 'latitude'].some(key => params.getAll(key).length !== 1)
    || keys.some(key => params.getAll(key).length > 1)) {
    throw new InvalidInputError('Provide longitude and latitude exactly once; optional parameters are eyeHeightM, azimuthStepDeg, maxDistanceM and format.');
  }
  if (params.has('format') && !['json', 'csv'].includes(params.get('format')!)) {
    throw new InvalidInputError('format must be json or csv.');
  }
  function number(key: string, min: number, max: number, fallback?: number): number {
    const raw = params.get(key)?.trim();
    if (raw === undefined && fallback !== undefined) return fallback;
    const value = Number(raw);
    if (!raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
      || !Number.isFinite(value) || value < min || value > max) {
      throw new InvalidInputError(`${key} must be a finite decimal number between ${min} and ${max}.`);
    }
    return value;
  }
  const query = {
    longitude: number('longitude', -180, 360), latitude: number('latitude', -90, 90),
    eyeHeightM: number('eyeHeightM', 0.1, 10, 2),
    azimuthStepDeg: number('azimuthStepDeg', 0.125, 10, 0.125),
    maxDistanceM: number('maxDistanceM', 100, 480000, 480000),
  };
  if (!Number.isInteger(360 / query.azimuthStepDeg)) {
    throw new InvalidInputError('azimuthStepDeg must divide 360 into an integer number of directions.');
  }
  return query;
}

export function createMoonRoutes(fetchAsset?: AssetFetcher) {
  const app = new Hono<{ Bindings: TerrainBindings }>();
  app.onError((error, c) => {
    if (error instanceof InvalidInputError) return c.json({ error: { code: 'INVALID_INPUT', message: error.message } }, 400);
    if (error instanceof TerrainError) return c.json({ error: { code: error.code, message: error.message } }, error.status);
    throw error;
  });
  app.get('/', async c => {
    const params = new URL(c.req.url).searchParams;
    const query = parseMoonQuery(params);
    const profile = await getMoonProfile(query, fetchAsset ?? terrainAssetFetcher(c.env, c.req.url));
    if (params.get('format') === 'csv') {
      return new Response(moonCsv(profile), { headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="lunar-lense-moon-horizon.csv"',
      } });
    }
    return c.json(profile);
  });
  return app;
}
