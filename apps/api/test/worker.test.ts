import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFetchMock, Miniflare } from 'miniflare';
import type { ApiError, HorizonResponse } from '@lunar-lense/contracts';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const fixture = async (name: string) => JSON.parse(
  await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
);
const earth = await fixture('earth');
const sun = await fixture('sun');
const expected = await fixture('expected');
const horizonUrl = 'http://localhost/api/horizon?date=2026-11-14&longitude=23.5&latitude=-10';

test('bundled Worker preserves API behavior and static asset routing', { timeout: 30_000 }, async (t) => {
  const commands: string[] = [];
  let failNext = false;
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  fetchMock.get('https://ssd.jpl.nasa.gov')
    .intercept({ path: /^\/api\/horizons\.api\?/, method: 'GET' })
    .reply((request) => {
      const command = new URL(request.path, 'https://ssd.jpl.nasa.gov').searchParams.get('COMMAND')!;
      commands.push(command);
      if (failNext) {
        failNext = false;
        return { statusCode: 503, data: 'upstream unavailable' };
      }
      return { statusCode: 200, data: JSON.stringify(command === "'399'" ? earth : sun) };
    })
    .delay(10)
    .persist();

  const runtime = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
    compatibilityDate: config.compatibility_date,
    fetchMock,
    assets: {
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

  await t.test('serializes overlapping requests in one instance', async () => {
    const responses = await Promise.all([
      runtime.dispatchFetch(horizonUrl),
      runtime.dispatchFetch(horizonUrl),
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
