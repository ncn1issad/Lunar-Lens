# Lunar Lense

A pnpm workspace with a Hono API on Cloudflare Workers and a Vite, React, and TypeScript frontend served through Workers Static Assets. The home page has introductory text on the left and a textured 3D Moon on the right, with a Catppuccin Mocha space background and subtle stars. Drag the Moon to rotate it. Scroll anywhere to move through the input sections. The globe uses Three.js and a locally packaged NASA LROC texture, with a soft fill light to keep the night side visible. "Start planning" scrolls to the time-range editor in the left column. Home and Time links in a fixed top pill jump between centred scroll sections. As the time editor comes into view, the Moon shrinks and moves right to leave room for the wider calendar; `/#plan` opens the time section directly. Terrain displacement and timeline display controls are not implemented yet.

The time-range editor has date and time accordion sections, with exactly one open. Two calendar months support inclusive range selection, hover previews, month/year navigation, and keyboard navigation. On narrow screens, the two months stack vertically. Separate start/end clocks support pointer selection, keyboard editing, and AM/PM selection. All values are UTC. Hovering a calendar day previews the Moon at that date after a 300 ms delay; moving between days preserves the preview, and leaving returns to the last clicked date. Rotation and sunlight ease between previews over roughly 750 ms, with reduced-motion preferences respected. The home section still uses the current browser time. Valid edits are retained automatically in session storage for the current tab, with no separate save button. Validation matches the API's supported years, requires the end after the start, and limits duration to 366 days.

The Submit button stays at the bottom right of the input sections and follows the Location panel's right edge as it enters. It sends the current UTC range and lunar coordinates to `GET /api/timeline` with hourly sampling. Incomplete or invalid selections disable submission, and editing selections cancels an unfinished request. The button shows its loading state, with plain text for API errors. A successful response adds a full-viewport Surface section below Location and scrolls to it. Scroll back up to edit the still-mounted inputs and submit again; the next successful response replaces the scene. The Surface section and its navigation link appear only after a successful submission, which is retained for refresh in the current tab.

The location step at `/#location` slides in beside a narrower time panel, with an enlarged Moon behind both. Latitude and longitude fields, a single preset column, and clicks on the globe share one selection. The adjacent Recent column keeps the latest 10 successfully submitted custom locations in memory, newest first. Selecting a recent location restores its coordinates, and submitting it again moves it to the top. Presets do not enter Recent, and reloading clears the history. Dragging rotates the Moon without selecting a point. The marker follows the selected lunar coordinates; choosing coordinates or a preset rotates the view to bring the marker into view, including far-side and polar locations. Valid location edits persist in session storage. Coordinates allow full lunar coverage, north-positive latitude and east-positive longitude, with western longitudes accepted as negative values. Presets include Marius Hills, both poles, and Apollo landing sites using [NASA's LRO-based coordinates](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html). On narrow screens the input steps remain stacked.

The home page reads the browser clock to calculate current sunlight, phase, and lunar orientation with [Astronomy Engine](https://github.com/cosinekitty/astronomy). It starts with an Earth-centred, lunar-north-up view, refreshes every minute and on tab return, and preserves camera interaction. The Moon renders in a full-viewport canvas behind the page content, with its position framed on the right. Wheel zoom is disabled in this flow so scrolling over the Moon moves the inputs; drag rotation remains enabled. No API call or location permission is required. The view does not include the tilt relative to a local observer's horizon or eclipse shadows. Other uses of `MoonGlobe` remain evenly lit unless its `live` prop is enabled.

The API returns Earth's and the Sun's apparent azimuth and elevation from NASA/JPL Horizons for a lunar observer. `/api/timeline` combines timestamped position tables with a terrain skyline and terrain-aware visibility, as JSON or CSV. `/api/moon` remains available for the terrain profile alone. The original `/api/horizon` endpoint and `moon_horizon.py` retain their single-date, flat-horizon behavior.

See [TODO.md](TODO.md) for the agreed final API, terrain calculation and data-loading plans, implementation priorities, and open decisions. It records the relevant earlier chat discussions so future work can start here.

See [Terrain profiles](docs/terrain.md) for `/api/moon`, its JSON/CSV contract, coverage, data preparation, and sampling limits. Calculations use global NASA LOLA LDEM_64 within 60 km and LDEM_16 from 60 km to a default 480 km radius. Fine Marius Hills and polar terrain remains separate for rendering and is never loaded by the calculation endpoints.

See [Moon rendering data](docs/moon-rendering-data.md) for researched global textures, elevation maps, QuickMap mesh endpoints, and a proposed data plan for the 3D interface.

See [Surface imagery API](docs/surface-imagery-api.md) for `GET /api/imagery/layers/wac-global` metadata and `GET /api/imagery/tiles/wac-global/{z}/{x}/{y}` JPEG tiles from Moon Trek. The API validates the geographic tile grid and applies a 15-second upstream timeout.

The [submitted surface view](docs/surface-preview.md) fills the viewport at `/#surface` after a successful submission. It uses the returned observer and Earth/Sun directions at the selected start time, global LDEM_64 terrain, and streamed Moon Trek imagery. Drag to look around, or scroll up to submit a different location. There is no separate results route.

## Structure

```text
apps/
  api/
    src/                 Hono routes, validation and Horizons client
    test/                Offline fixtures and API/runtime tests
    wrangler.jsonc       Worker and static asset configuration
  web/                   React TypeScript frontend with a Three.js Moon globe
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

## Single-date request

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

## Timeline and CSV downloads

```sh
curl 'http://localhost:8787/api/timeline?start=2026-11-14&end=2026-11-15&longitude=303&latitude=14&stepMinutes=60&eyeHeightM=2'
```

This returns 25 hourly samples per body, including midnight at both ends, and one shared terrain skyline. `/api/timeline` and `/api/moon` use the same terrain service without an HTTP call between endpoints. The existing `/api/horizon` endpoint keeps its original behavior.

| Parameter | Required | Meaning and limits |
| --- | --- | --- |
| `start` | Yes | Gregorian date `YYYY-MM-DD` (midnight UTC) or full UTC timestamp `YYYY-MM-DDTHH:mm:ssZ`; years 1962 through 2649 |
| `end` | Yes | Same format as `start`; must be after it, with a range of at most 366 days |
| `longitude` | Yes | Lunar longitude in degrees, east positive, -180 through 360 |
| `latitude` | Yes | Lunar latitude in degrees, north positive, -90 through 90 |
| `stepMinutes` | No | Whole number of minutes, 1 through 527040; defaults to 60 |
| `eyeHeightM` | No | Height above terrain, 0.1 through 10 metres; defaults to 2 |
| `azimuthStepDeg` | No | Skyline spacing, 0.125 through 10 degrees; must divide 360 into a whole number of directions; defaults to 0.125 (2,880 directions) |
| `maxDistanceM` | No | Terrain search radius, 100 through 480000 metres; defaults to 480000; switches calculation data at 60000 metres |
| `format` | No | `json` (default) or `csv` |

Unknown or repeated parameters are rejected. At most 10,000 samples per body are allowed. The first sample is at `start`; subsequent samples advance by `stepMinutes`, up to and including `end` only when it falls on the sample grid. A range shorter than one step produces one sample. Invalid calendar dates, timezone offsets, fractional seconds, leap-second inputs, and pre-1962 dates are rejected by this endpoint. The original single-date endpoint still supports its historical UT1 behavior.

Global coverage includes both poles and the longitude seam. Terrain tiles are loaded and verified once per request, then reused for one skyline and every timestamp. Searches up to 60 km use only LDEM_64; larger searches add LDEM_16. The API never requests the fine rendering terrain or individual height samples from NASA. Far-field cell envelopes cover gaps between rays and can overestimate an obstruction's angular extent. Missing or corrupt calculation data fails explicitly, with no flat-horizon fallback.

For example, request the north-pole timeline or the standalone south-pole skyline:

```sh
curl 'http://localhost:8787/api/timeline?start=2026-11-15&end=2026-11-16&longitude=0&latitude=90'
curl 'http://localhost:8787/api/moon?longitude=0&latitude=-90'
```

The response keeps its top-level fields. `moon.terrain` describes the global LOD model and lists each source under `layers`, including its resolution, active distance band, encoding, source hashes, and loaded bytes. Full tile hash indices stay in the asset manifests. At either exact pole, the model uses the mean of the closest complete LDEM_64 latitude ring for one longitude-independent ground height. Supplied longitude still defines the azimuth reference and is used consistently by the skyline and Horizons.

`altitudeKm` is now computed from interpolated ground elevation plus `eyeHeightM`, and the same altitude is sent to Horizons. It is no longer accepted as an independent query parameter. Both calculations use the DE421 lunar mean-Earth frame and a 1737.4 km reference sphere. JPL documents that observer frame in its [coordinate definitions](https://ssd.jpl.nasa.gov/horizons/manual.html#observer) and [lunar frame description](https://ssd.jpl.nasa.gov/horizons/manual.html#reference-frames). Timeline dates are restricted to 1962 through 2649 to stay within UTC and the high-precision lunar model's interval. The parser also checks each NASA response's observer frame and spherical radii, and rejects incompatible or fallback models.

The JSON response has this structure:

- `timeScale`: `"UTC"`.
- `range`: normalized `start` and `end`, `stepMinutes`, and `sampleCount` per body.
- `observer`: `body: "moon"`, normalized `longitudeDeg`, `latitudeDeg`, `groundElevationM`, `eyeHeightM`, and derived `altitudeKm`.
- `moon`: the same `horizon`, `terrain` provenance, and `calculation` metadata returned by `/api/moon` for the same inputs.
- `positions.earth` and `positions.sun`: aligned arrays, each row containing `timestamp`, `azimuthDeg`, `elevationDeg`, `terrainHorizonElevationDeg`, and `isVisible`.
- `visibilityModel`: `"terrain"`. Each body's center is visible when `elevationDeg >= terrainHorizonElevationDeg`. The skyline is linearly interpolated at the body's azimuth, including across north. Negative skyline elevations are preserved; disk size and partial disk visibility are not included.
- `source`: `"NASA/JPL Horizons"`.

Timestamps are preserved from NASA's output and normalized to UTC `YYYY-MM-DDTHH:mm:ssZ`. Missing, duplicate, shifted, or malformed samples cause a `502 HORIZONS_ERROR` rather than a partial or misaligned result. NASA may reject dates outside its ephemeris coverage even when they pass input validation.

Add `format=csv` to get a file attachment. Browsers download the file; with curl, `-OJ` saves it under the response's filename:

```sh
curl -OJ 'http://localhost:8787/api/timeline?start=2026-11-14&end=2026-11-15&longitude=303&latitude=14&stepMinutes=60&eyeHeightM=2&format=csv'
```

The response uses `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="lunar-lense-timeline-2026-11-14-2026-11-15.csv"`. CSV has one row per timestamp, with Earth and Sun columns together, including the skyline elevation used for each visibility flag. Its header is:

```csv
timestamp,timeScale,longitudeDeg,latitudeDeg,altitudeKm,visibilityModel,earthAzimuthDeg,earthElevationDeg,earthIsVisible,sunAzimuthDeg,sunElevationDeg,sunIsVisible,groundElevationM,eyeHeightM,terrainDatasetId,terrainReferenceFrame,azimuthStepDeg,maxDistanceM,earthTerrainHorizonElevationDeg,sunTerrainHorizonElevationDeg
```

Both formats use the same combined dataset and terrain-aware visibility rules. The full skyline is available in timeline JSON or through `/api/moon`, whose CSV contains one row per compass direction. Errors remain JSON and do not have an attachment header. Each successful timeline request makes two sequential NASA range calls total, regardless of sample count. There is no persistent cache, so requesting JSON and then CSV recalculates the skyline and makes another pair of calls. A future interface can export its already loaded data locally and move its slider without new API calls. No timeline interface is implemented yet.

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
| 400 | `INVALID_INPUT` | Missing or invalid parameters, including imagery coordinates |
| 404 | `NOT_FOUND` | Unknown API route, imagery layer, or missing imagery tile |
| 422 | `TERRAIN_OUT_OF_COVERAGE` | Terrain calculation exceeds its work or buffer budget |
| 422 | `TERRAIN_MISSING_DATA` | A required terrain height is missing or invalid |
| 503 | `TERRAIN_UNAVAILABLE` | Terrain assets are absent, corrupt, or unavailable |
| 502 | `HORIZONS_ERROR` | Upstream HTTP, network, JSON, or ephemeris failure |
| 504 | `HORIZONS_TIMEOUT` | An upstream request exceeded 45 seconds |
| 502 | `IMAGERY_ERROR` | Imagery HTTP/network failure, wrong content type, empty image, or body download failure |
| 504 | `IMAGERY_TIMEOUT` | An imagery request, including its body, exceeded 15 seconds |
| 500 | `INTERNAL_ERROR` | Unexpected application failure |

The Horizons client serializes Earth and Sun calls and concurrent callers within one Worker instance. This is a private prototype setup. Cloudflare may run multiple instances, even for overlapping requests from one user, so this queue does not guarantee one upstream request at a time across the deployment.

Before public use, add shared coordination, for example a named Durable Object, to meet [JPL's API policy](https://ssd-api.jpl.nasa.gov/doc/index.php). No Durable Objects, SQLite databases, or object storage are provisioned. Prepared terrain uses the existing `ASSETS` binding.

There is no result cache yet. Each successful single-date or timeline request makes two upstream calls, so it can take up to about 90 seconds, plus time spent waiting for earlier requests in the same instance. Both endpoints share the instance-local queue.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm test` builds both apps before running offline tests. The suite checks single-date and timeline queries, JSON/CSV agreement, validation, upstream failures, shared request serialization, imagery metadata and JPEG proxying, and the bundled Worker in Cloudflare's local runtime. NASA responses are mocked using captured fixtures, so tests do not contact the live service. Runtime tests dispose of their local instances after completion.

See [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers), [Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), and [Horizons documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
