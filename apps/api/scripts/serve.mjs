import { access, readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const apiDirectory = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', apiDirectory), 'utf8'));
const scriptPath = fileURLToPath(new URL('dist/index.js', apiDirectory));
const directory = fileURLToPath(new URL(config.assets.directory, apiDirectory));
const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 5173);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a whole number between 1 and 65535.');
}

try {
  await Promise.all([access(scriptPath), access(new URL('index.html', new URL(`${config.assets.directory}/`, apiDirectory)))]);
} catch {
  throw new Error('The build is missing. Run pnpm build before pnpm start.');
}

const runtime = new Miniflare({
  host,
  port,
  modules: true,
  scriptPath,
  compatibilityDate: config.compatibility_date,
  assets: {
    binding: config.assets.binding,
    directory,
    routerConfig: {
      has_user_worker: true,
      static_routing: { user_worker: config.assets.run_worker_first },
    },
    assetConfig: { not_found_handling: config.assets.not_found_handling },
  },
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await runtime.dispose();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  await runtime.ready;
  console.log(`Lunar Lens build: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  if (host === '0.0.0.0') {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          console.log(`Local network: http://${address.address}:${port}`);
        }
      }
    }
  }
} catch (error) {
  await stop();
  throw error;
}
