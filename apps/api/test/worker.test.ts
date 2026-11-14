import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFetchMock, Miniflare } from 'miniflare';
import type { ApiError, HorizonResponse, TimelineResponse } from '@lunar-lense/contracts';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const fixture = async (name: string) => JSON.parse(
  await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
);
const earth = await fixture('earth');
const sun = await fixture('sun');
const expected = await fixture('expected');
const timelineEarth = await fixture('timeline-earth');
const timelineSun = await fixture('timeline-sun');
const horizonUrl = 'http://localhost/api/horizon?date=2026-11-14&longitude=23.5&latitude=-10';
const timelineUrl = 'http://localhost/api/timeline?start=2026-11-14T00:00:00Z&end=2026-11-14T02:00:00Z&longitude=303&latitude=14';

test('bundled Worker preserves API behavior and static asset routing', { timeout: 30_000 }, async (t) => {
  const commands: string[] = [];
  const timelineSites: string[] = [];
  let failNext = false;
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  fetchMock.get('https://ssd.jpl.nasa.gov')
    .intercept({ path: /^\/api\/horizons\.api\?/, method: 'GET' })
    .reply((request) => {
      const params = new URL(request.path, 'https://ssd.jpl.nasa.gov').searchParams;
      const command = params.get('COMMAND')!;
      commands.push(command);
      if (params.has('START_TIME')) timelineSites.push(params.get('SITE_COORD')!);
      if (failNext) {
        failNext = false;
        return { statusCode: 503, data: 'upstream unavailable' };
      }
      const payload = params.has('START_TIME')
        ? (command === "'399'" ? timelineEarth : timelineSun)
        : (command === "'399'" ? earth : sun);
      return { statusCode: 200, data: JSON.stringify(payload) };
    })
    .delay(10)
    .persist();

  const runtime = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    compatibilityDate: config.compatibility_date,
    fetchMock,
    assets: {
      binding: config.assets.binding,
      directory: fileURLToPath(new URL(config.assets.directory, new URL('../', import.meta.url))),
      routerConfig: {
        has_user_worker: true,
        static_routing: { user_worker: config.assets.run_worker_first },
      },
      assetConfig: { not_found_handling: config.assets.not_found_handling },
    },
  });
  t.after(() => runtime.dispose());

  await t.test('serves the default frontend, its assets, and navigation fallback', async () => {
    const response = await runtime.dispatchFetch('http://localhost/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/html/);
    const html = await response.text();
    assert.match(html, /<div id="root"><\/div>/);
    const script = html.match(/src="([^\"]+\.js)"/)![1]!;
    const asset = await runtime.dispatchFetch(new URL(script, 'http://localhost'));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type')!, /javascript/);
    const navigation = await runtime.dispatchFetch('http://localhost/explore/moon', {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });
    assert.equal(navigation.status, 200);
    assert.equal(await navigation.text(), html);
  });

  await t.test('keeps API health, errors and navigations out of the SPA fallback', async () => {
    const health = await runtime.dispatchFetch('http://localhost/api/health');
    assert.deepEqual(await health.json(), { status: 'ok' });
    for (const path of ['/api', '/api/unknown']) {
      const missing = await runtime.dispatchFetch(`http://localhost${path}`, {
        headers: { 'Sec-Fetch-Mode': 'navigate' },
      });
      assert.equal(missing.status, 404);
      assert.equal((await missing.json() as ApiError).error.code, 'NOT_FOUND');
    }
    const invalid = await runtime.dispatchFetch('http://localhost/api/horizon');
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json() as ApiError).error.code, 'INVALID_INPUT');
    assert.deepEqual(commands, []);
  });

  await t.test('parses captured NASA responses in the Workers runtime', async () => {
    const response = await runtime.dispatchFetch(horizonUrl);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as HorizonResponse).positions, expected);
    assert.deepEqual(commands.splice(0), ["'399'", "'10'"]);
  });

  await t.test('returns a complete timeline and CSV download through the bundled Worker', async () => {
    const response = await runtime.dispatchFetch(timelineUrl);
    assert.equal(response.status, 200);
    const timeline = await response.json() as TimelineResponse;
    assert.equal(timeline.range.sampleCount, 3);
    assert.deepEqual(timeline.positions.earth.map((row) => row.timestamp), [
      '2026-11-14T00:00:00Z', '2026-11-14T01:00:00Z', '2026-11-14T02:00:00Z',
    ]);
    assert.equal(timeline.positions.sun[0]!.isVisible, false);
    assert.equal(timeline.visibilityModel, 'terrain');
    assert.equal(timeline.moon.horizon.length, 720);
    assert.equal(timeline.observer.altitudeKm,
      (timeline.observer.groundElevationM + timeline.observer.eyeHeightM) / 1000);
    for (const position of [...timeline.positions.earth, ...timeline.positions.sun]) {
      assert.equal(position.isVisible, position.elevationDeg >= position.terrainHorizonElevationDeg);
    }
    const download = await runtime.dispatchFetch(`${timelineUrl}&format=csv`, {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(download.headers.get('content-disposition')!, /^attachment; filename=".*\.csv"$/);
    const lines = (await download.text()).trim().split('\r\n');
    assert.equal(lines.length, 4);
    assert.match(lines[0]!, /^timestamp,timeScale,/);
    assert.match(lines[1]!, /^2026-11-14T00:00:00Z,UTC,/);
    assert.equal(timelineSites.length, 4);
    assert.ok(timelineSites.every(site => site === `'303,14,${timeline.observer.altitudeKm}'`));
    assert.deepEqual(commands.splice(0), ["'399'", "'10'", "'399'", "'10'"]);

    const invalid = await runtime.dispatchFetch(`${timelineUrl}&stepMinutes=0&format=csv`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get('content-disposition'), null);
    assert.equal((await invalid.json() as ApiError).error.code, 'INVALID_INPUT');
    assert.deepEqual(commands, []);
  });

  await t.test('serializes overlapping timeline and single-sample requests in one instance', async () => {
    const responses = await Promise.all([
      runtime.dispatchFetch(horizonUrl),
      runtime.dispatchFetch(timelineUrl),
    ]);
    for (const response of responses) {
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    assert.deepEqual(commands.splice(0), ["'399'", "'10'", "'399'", "'10'"]);
  });

  await t.test('returns upstream errors and recovers for the next request', async () => {
    failNext = true;
    const failed = await runtime.dispatchFetch(horizonUrl);
    assert.equal(failed.status, 502);
    assert.equal((await failed.json() as ApiError).error.code, 'HORIZONS_ERROR');
    const recovered = await runtime.dispatchFetch(horizonUrl);
    assert.equal(recovered.status, 200);
    assert.deepEqual((await recovered.json() as HorizonResponse).positions, expected);
    assert.deepEqual(commands, ["'399'", "'399'", "'10'"]);
  });
});
