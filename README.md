# Lunar Lense

A pnpm workspace with a Hono API on Cloudflare Workers and a Vite, React, and TypeScript frontend served through Workers Static Assets. The frontend is the default Vite starter.

The API currently returns one midnight sample of Earth's and the Sun's apparent azimuth and elevation from NASA/JPL Horizons for a lunar surface observer. Time-series responses and lunar terrain profiles are future work. The original `moon_horizon.py` remains available at the repository root.

## Structure

```text
apps/
  api/
    src/                 Hono routes, validation and Horizons client
    test/                Offline fixtures and API/runtime tests
    wrangler.jsonc       Worker and static asset configuration
  web/                   Default Vite React TypeScript starter
packages/
  contracts/             Shared API request and response types
```

The contracts package contains types only. Both apps can import its definitions with `import type { HorizonResponse } from '@lunar-lense/contracts'`.

## Development

Use Node.js 22.12+ (or a current LTS release) and pnpm 10.33.0.

```sh
pnpm install
pnpm dev
```

The root development command first builds a static frontend snapshot for Wrangler, then starts both development servers:

- `http://localhost:5173` runs Vite with hot reload. Its `/api` requests are proxied to Wrangler.
- `http://localhost:8787` runs the Worker locally. It also serves the last built frontend snapshot.

No Cloudflare account is needed for local development. Stop both servers with Ctrl+C. Wrangler stores local development files under `apps/api/.wrangler/`.

To preview the combined production build locally:

```sh
pnpm preview
```

This builds both apps and starts only Wrangler at `http://localhost:8787`. No Vite server runs in production.

## Build and deploy

```sh
pnpm build
```

This builds the frontend into `apps/web/dist`, then bundles the Worker into `apps/api/dist` using a Wrangler deployment dry run. It does not publish anything.

When ready to publish, authenticate Wrangler with your Cloudflare account and run:

```sh
pnpm --filter @lunar-lense/api exec wrangler login
pnpm run deploy
```

Deployment creates or updates the `lunar-lense` Worker and uploads the frontend assets using `apps/api/wrangler.jsonc`. It needs no Node.js server or container. These commands are provided for deployment; the repository setup does not deploy automatically.

The deployed frontend and API share an origin:

- `/api` and `/api/*` always reach the Hono Worker, including browser navigations and unknown API routes.
- Existing frontend assets are served directly through Static Assets.
- Frontend navigation paths fall back to `index.html` for client-side routing.

The API and frontend remain separate workspace packages. They can be deployed separately later. A separate frontend origin would also need an API URL and CORS configuration.

## Request

```sh
curl 'http://localhost:8787/api/horizon?date=2026-11-14&longitude=23.5&latitude=-10'
```

All query parameters are required exactly once. Unknown parameters are rejected.

| Parameter | Meaning | Accepted values |
| --- | --- | --- |
| `date` | Gregorian date, sampled at midnight | Valid `YYYY-MM-DD`, years 0001 through 9999 |
| `longitude` | Lunar longitude in degrees, east positive | -180 through 360 |
| `latitude` | Lunar latitude in degrees, north positive | -90 through 90 |

Horizons may reject dates outside the available ephemeris coverage even if the date is valid.

The JSON response contains `date`, `time`, `timeScale`, `observer`, `positions.earth`, `positions.sun`, and `source`. Each position has `azimuthDeg`, `elevationDeg`, and `isVisible`.

- Azimuth is clockwise from north, in the range [0, 360).
- Elevation is in the range [-90, 90]. Bodies below the horizon remain in the response.
- `isVisible` is true when the body's center has elevation >= 0. It assumes a flat horizon and ignores terrain and disk size.
- Observer altitude is fixed at 0 km above the lunar reference sphere.
- Time is fixed at `00:00:00`. The time scale is UTC for dates from 1962 onward and UT1 for earlier dates, as in the Python script.

`GET /api/health` returns `{"status":"ok"}` without contacting NASA.

## Errors and upstream coordination

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Use a valid Gregorian date in YYYY-MM-DD format."
  }
}
```

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Missing or invalid query parameters |
| 404 | `NOT_FOUND` | Unknown API route |
| 502 | `HORIZONS_ERROR` | Upstream HTTP, network, JSON, or ephemeris failure |
| 504 | `HORIZONS_TIMEOUT` | An upstream request exceeded 45 seconds |
| 500 | `INTERNAL_ERROR` | Unexpected application failure |

The Horizons client serializes Earth and Sun calls and concurrent callers within one Worker instance. This is a private prototype setup. Cloudflare may run multiple instances, even for overlapping requests from one user, so this queue does not guarantee one upstream request at a time across the deployment.

Before public use, add shared coordination, for example a named Durable Object, to meet [JPL's API policy](https://ssd-api.jpl.nasa.gov/doc/index.php). No Durable Objects, SQLite databases, or storage bindings are provisioned by the current configuration.

There is no result cache yet. Each successful request makes two upstream calls, so it can take up to about 90 seconds, plus time spent waiting for earlier requests in the same instance.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm test` builds both apps before running offline tests. The suite checks the existing endpoint behavior and the bundled Worker in Cloudflare's local runtime. NASA responses are mocked, so tests do not contact the live service. Runtime tests dispose of their local instances after completion.

See [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers), [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), and [Horizons documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
