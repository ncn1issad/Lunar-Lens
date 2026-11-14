import { Hono } from 'hono';
import type { GeographicImageryLayer } from '@lunar-lense/contracts';
import { InvalidInputError } from './validation.js';

const wacGlobal: GeographicImageryLayer = {
  id: 'wac-global',
  source: 'Moon Trek',
  sourceLayer: 'LRO_WAC_Mosaic_Global_303ppd_v02',
  projection: 'equirectangular',
  nativeCrs: 'urn:ogc:def:crs:EPSG::104903',
  longitudeConvention: 'east-positive',
  boundsDeg: { west: -180, south: -90, east: 180, north: 90 },
  tileSize: 256,
  minZoom: 0,
  maxZoom: 8,
  matrixSet: 'default028mm',
  scheme: 'xyz',
  levelZeroColumns: 2,
  levelZeroRows: 1,
  contentType: 'image/jpeg',
  tileUrlTemplate: '/api/imagery/tiles/wac-global/{z}/{x}/{y}',
  appearance: 'photographic',
  credit: 'NASA / LRO / LROC; served by Moon Trek',
};

const upstreamBase = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm';

export interface ImageryOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

class ImageryError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'IMAGERY_ERROR' | 'IMAGERY_TIMEOUT',
    readonly status: 404 | 502 | 504,
  ) {
    super(message);
    this.name = 'ImageryError';
  }
}

function getLayer(id: string): GeographicImageryLayer {
  if (id !== wacGlobal.id) {
    throw new ImageryError('Imagery layer not found.', 'NOT_FOUND', 404);
  }
  return wacGlobal;
}

function integer(raw: string, name: string): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new InvalidInputError(`${name} must be a non-negative integer.`);
  }
  return value;
}

export function createImageryRoutes({ fetcher = fetch, timeoutMs = 15_000 }: ImageryOptions = {}) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof InvalidInputError) {
      return c.json({ error: { code: 'INVALID_INPUT', message: error.message } }, 400);
    }
    if (error instanceof ImageryError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  });

  app.get('/layers/:layerId', c => c.json(getLayer(c.req.param('layerId'))));

  app.get('/tiles/:layerId/:z/:x/:y', async c => {
    const layer = getLayer(c.req.param('layerId'));
    const z = integer(c.req.param('z'), 'z');
    const x = integer(c.req.param('x'), 'x');
    const y = integer(c.req.param('y'), 'y');
    if (z < layer.minZoom || z > layer.maxZoom) {
      throw new InvalidInputError(`z must be between ${layer.minZoom} and ${layer.maxZoom}.`);
    }
    const columns = layer.levelZeroColumns * 2 ** z;
    const rows = layer.levelZeroRows * 2 ** z;
    if (x >= columns || y >= rows) {
      throw new InvalidInputError(`At zoom ${z}, x must be below ${columns} and y below ${rows}.`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = AbortSignal.any([controller.signal, c.req.raw.signal]);
    try {
      // Moon Trek's WMTS path uses row/column, unlike our XYZ route.
      const response = await fetcher(`${upstreamBase}/${z}/${y}/${x}.jpg`, {
        headers: { Accept: layer.contentType },
        // Workers supports manual/follow only; reject 3xx in the status check below.
        redirect: 'manual',
        signal,
      });
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (response.status !== 200 || contentType !== layer.contentType) {
        await response.body?.cancel();
        if (response.status === 404) {
          throw new ImageryError('Imagery tile not found.', 'NOT_FOUND', 404);
        }
        throw new ImageryError('Moon Trek returned an invalid imagery response.', 'IMAGERY_ERROR', 502);
      }
      // Finish downloading before sending image headers so body failures stay JSON errors.
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      if (bytes.byteLength === 0) {
        throw new ImageryError('Moon Trek returned an empty imagery tile.', 'IMAGERY_ERROR', 502);
      }
      return new Response(bytes, { headers: { 'Content-Type': layer.contentType } });
    } catch (error) {
      if (error instanceof ImageryError) throw error;
      if (controller.signal.aborted) {
        throw new ImageryError('Moon Trek imagery request timed out.', 'IMAGERY_TIMEOUT', 504);
      }
      throw new ImageryError('Cannot fetch a Moon Trek imagery tile.', 'IMAGERY_ERROR', 502);
    } finally {
      clearTimeout(timer);
    }
  });

  return app;
}
