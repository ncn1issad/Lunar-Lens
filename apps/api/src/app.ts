import { Hono } from 'hono';
import type { HorizonQuery, HorizonResponse, Positions } from '@lunar-lense/contracts';
import { createHorizonsClient, HorizonsError } from './horizons.js';
import { InvalidInputError, parseHorizonQuery } from './validation.js';
import { createMoonRoutes } from './terrain/routes.js';
import { registerTimelineRoute, type GetTimeline } from './timeline.js';
import { TerrainError } from './terrain/errors.js';
import type { AssetFetcher } from './terrain/loader.js';
import type { TerrainBindings } from './terrain/service.js';

interface AppOptions {
  getPositions?: (query: HorizonQuery) => Promise<Positions>;
  getTimeline?: GetTimeline;
  fetchTerrainAsset?: AssetFetcher;
}

export function buildApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: TerrainBindings }>();
  const client = createHorizonsClient();
  const getPositions = options.getPositions ?? client;

  app.onError((error, c) => {
    if (error instanceof InvalidInputError) {
      return c.json({ error: { code: 'INVALID_INPUT', message: error.message } }, 400);
    }
    if (error instanceof TerrainError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof HorizonsError) {
      return c.json({
        error: {
          code: error.statusCode === 504 ? 'HORIZONS_TIMEOUT' : 'HORIZONS_ERROR',
          message: error.message,
        },
      }, error.statusCode);
    }
    console.error(error);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } }, 500);
  });

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.route('/api/moon', createMoonRoutes(options.fetchTerrainAsset));

  registerTimelineRoute(app, options.getTimeline ?? client.timeline, options.fetchTerrainAsset);

  app.get('/api/horizon', async (c) => {
    const query = parseHorizonQuery(new URL(c.req.url).searchParams);
    const positions = await getPositions(query);
    const response: HorizonResponse = {
      date: query.date,
      time: '00:00:00',
      timeScale: Number(query.date.slice(0, 4)) >= 1962 ? 'UTC' : 'UT1',
      observer: {
        body: 'moon', longitudeDeg: query.longitude, latitudeDeg: query.latitude, altitudeKm: 0,
      },
      positions,
      source: 'NASA/JPL Horizons',
    };
    return c.json(response);
  });

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404));

  return app;
}
