# Lunar Lense plans

This file records the project decisions and terrain discussions through 2026-11-15. Use it with [README.md](README.md) instead of searching earlier chats. The README documents the running application; this file describes planned work. Unchecked items are not implemented.

## Current implementation

- A pnpm workspace with `apps/api`, `apps/web`, and `packages/contracts`.
- A Hono API on Cloudflare Workers. The earlier Fastify implementation was migrated to Hono.
- A Vite, React, and TypeScript frontend served through Workers Static Assets, with a Three.js Moon globe on a black background. Drag rotation and scroll/pinch zoom are implemented. The NASA LROC texture is packaged locally; the globe currently uses spherical geometry without terrain displacement.
- The home page uses Astronomy Engine and the browser clock for current sunlight and lunar orientation, with a lunar-north-up Earth-centred starting view. It refreshes each minute and on tab return without resetting camera controls. No location or new API endpoint is used. Time-based lighting is opt-in through the globe's `live` prop.
- `GET /api/horizon` accepts a date and lunar longitude/latitude, then returns one midnight sample for Earth and the Sun.
- `GET /api/timeline` accepts a start/end, coordinates, sampling interval, and terrain settings. It returns aligned Earth/Sun tables with terrain-aware visibility and a shared `moon` profile as JSON, or the combined position table as a `format=csv` attachment. See the README for the implemented contract and limits.
- Each timeline row has `timestamp`, `azimuthDeg`, `elevationDeg`, `terrainHorizonElevationDeg`, and `isVisible`. Visibility compares the body's center against the interpolated terrain skyline. Disk size is not included. The legacy `/api/horizon` endpoint still compares elevation with zero.
- Observer altitude is fixed at 0 km for `/api/horizon`; `/api/timeline` derives altitude from terrain ground elevation plus `eyeHeightM` (default 2 m, maximum 10 m). An independent `altitudeKm` input is rejected.
- Horizons calls are sequential within one Worker instance. There is no result cache or coordination across instances.
- `GET /api/moon` independently returns a `moon.horizon` profile and observer height metadata as JSON or CSV. Calculations use global LDEM_64 within 60 km and LDEM_16 from 60 km to a default 480 km radius. Fine Marius Hills and 80 m polar files are reserved for rendering and are not requested for visibility calculations. Both endpoints share `apps/api/src/terrain/service.ts`. See [terrain documentation](docs/terrain.md) for preparation, sampling, errors, and verification.
- No Durable Objects, SQLite databases, or persistent result caches are configured.

## Agreed architecture and scope

Keep Hono on Cloudflare Workers and the Vite frontend on Workers Static Assets. The initial deployment shares an origin, with `/api` and `/api/*` routed to the Worker. Keep the workspace packages separate so independent deployments remain possible later.

The project has a short deadline. Prioritize a working implementation and measure performance before adding more infrastructure. The current scope is a private, mostly single-user prototype. Shared upstream coordination and Durable Objects were explicitly deferred. Keep the existing sequential calls within each instance; this deferral does not provide coordination across the deployment.

For this prototype, reuse data already loaded for the current calculation or browser session. Do not add a persistent result cache, a cache database, or a separate caching service. New API requests may fetch ephemerides and recalculate the skyline. Revisit caching across requests only if measured performance or repeated upstream calls justify it. Prepared terrain files are application input data, not a result-cache system.

The eventual interface should support an interactive Moon, Earth and Sun visuals, a timeline, and a transition between orbital and surface views. Those graphics run in the browser. They do not by themselves justify SSR or a move to Next.js. The first interface step is implemented with Three.js: only a textured Moon globe on black, with rotation and zoom. Additional controls, terrain displacement, and surface views remain future work.

## Target API behavior

- [x] Return a `moon` object containing a table of the terrain horizon around the observer, with horizon elevation at each sampled azimuth, through the separate global `/api/moon` endpoint.
- [x] Return Earth and Sun position tables over a selected time period, replacing the current single-sample limitation.
- [x] Let the caller select the sampling interval, subject to explicit request limits.
- [x] Return structured arrays and metadata in JSON for the interface. Both `/api/timeline` and `/api/moon` offer CSV downloads of their calculated tables rather than embedding CSV strings in JSON.
- [x] Use the same terrain-aware visibility calculation in timeline JSON and CSV exports. Future browser statistics must reuse these results rather than a zero-elevation threshold.
- [x] Include metadata for observer location and height, time scale, terrain source/version, and calculation resolution in the combined timeline response and standalone terrain endpoint.

The Earth/Sun contract is implemented in `packages/contracts/src/timeline.ts`, with validation in `apps/api/src/timeline-query.ts`, parsing and the shared upstream queue in `apps/api/src/horizons.ts`, and combined JSON/CSV routing in `apps/api/src/timeline.ts`. The existing `/api/horizon` contract remains intact. `/api/moon` and `packages/contracts/src/terrain.ts` remain available separately, with their own CSV layout. The timeline reuses the Moon profile service directly, derives the Horizons observer height, and enriches each position with terrain-aware visibility. No HTTP call between the API routes is needed.

### Earth and Sun time series

- [x] Extend the Horizons client to request ranges using `START_TIME`, `STOP_TIME`, and `STEP_SIZE`.
- [x] Within supported response sizes, fetch the full Earth table and full Sun table with two sequential upstream requests total. Do not issue two requests for every timestamp.
- [x] Extend CSV parsing to handle all returned rows and retain their timestamps. Keep the original single-date parser available for the old endpoint.
- [x] Bound time ranges and sample counts, and validate the returned timestamps and alignment between bodies.
- [ ] Load a range once in the browser. Moving the timeline slider should use loaded data; changing location, period, or interval can require a new request.

The timeline contract accepts dates or UTC timestamps in years 1962 through 2649, spans at most 366 days, and returns at most 10,000 samples per body. The dates stay within UTC and the supported high-precision DE421 mean-Earth observer frame interval. Upstream headers are also checked for the lunar frame and 1737.4 km spherical radii. Steps are whole minutes, defaulting to 60. The start is included; the end is included only when it falls on the sample grid. Bodies below the skyline remain in the tables. Historical UT1 queries remain available through the original single-date endpoint. The timeline reports `visibilityModel: "terrain"`. Missing or corrupt calculation data fails explicitly before any Horizons call.

## Terrain data and skyline calculation

### Data access

Terrain sampling means reading numerical heights from loaded elevation data. It does not mean making one NASA API request per direction or terrain point. Moon Trek image tiles can provide visual textures, but rendered elevation colors are not a substitute for numerical heights.

The calculation sources are global NASA LOLA LDEM_64 and LDEM_16 V3.1, in the MOON_ME_DE421 frame with a 1737.4 km reference sphere. Heights stay as native little-endian int16 values scaled by 0.5 metres. Download and preparation run offline; API requests read only packaged 256 by 256 tiles through ASSETS. There is no persistent result cache.

| Calculation range | Source | North/south spacing | Prepared global height bytes |
| --- | --- | --- | --- |
| Observer to 60 km | LDEM_64 | 473.8 m | 506.25 MiB |
| 60 to 480 km | LDEM_16 | 1.895 km | 34.5 MiB including edge padding |

- [x] Global calculation coverage, including both exact poles and longitude wraparound.
- [x] Keep fine terrain out of the calculation path. Retained SLDEM2015 and 80 m polar files are for rendering experiments only. Do not add a high-resolution calculation override.
- [x] Repeatable preparation with source-label validation, resumable byte ranges, and source/output hashes in `scripts/prepare-global-terrain.py`. The default MIT archive is checked against the canonical PDS label before resuming. `--mirror pds` selects PDS directly.
- [x] Load each required tile once per request and verify its hash. Decode native integers without a float32 copy. Total terrain buffers are limited to 48 MiB.
- [x] Default eye height is 2 m, accepted range 0.1 to 10 m. Always derive Horizons altitude from LDEM_64 ground height plus eye height.

### Calculation

The first ray sample is 1 m. LDEM_64 uses roughly 236.9 m radial steps through 60 km; LDEM_16 uses roughly 947.6 m steps afterward. Both the 60 km transition and final search endpoint are included. The default is 2,880 directions at 0.125-degree intervals. The maximum and default search radius are 480 km. Smaller explicit requests remain supported and avoid loading LDEM_16 when unnecessary.

Far-field pixel regions also contribute a conservative angular envelope to the skyline, including the two rays that bound each region. This covers represented peaks between rays but can overestimate their outline and hide a body that a finer model would expose. It cannot recover a narrow peak averaged away by the source DEM. Nearby sampling remains bilinear; angular/radial resolution is not a promise of obstacle accuracy. The fixed 480 km cutoff is a prototype decision, not an adaptive stopping proof.

At a pole, the cylindrical grid has no pixel exactly at 90 degrees. The model uses the complete nearest latitude-ring mean for one pole height and interpolates through the small polar cap. Observer longitude defines the azimuth basis, not a different ground height.

- [x] Calculate one skyline per observer configuration and reuse it across the time series and CSV serialization.
- [x] Bound ray work to three million samples and far-field coverage to two million cells, plus the 48 MiB tile-buffer budget.
- [x] Verify peaks between rays, a mountain beyond 240 km, the LOD boundary, seams, poles, source scaling/hashes, and JSON/CSV consistency.
- [x] Check the full prepared dataset in local workerd. On 2026-11-15 all 64 API tests passed; default profiles took about 0.5 seconds at low latitudes and 0.8-0.9 seconds near the poles, with 1.4-17 MiB of retained terrain buffers at tested locations. See the measured table in `docs/terrain.md`.
- [ ] Measure production CPU and total isolate memory. Local runtime tests report wall time and tile-buffer bytes only. Workers Free allows 10 ms CPU per invocation and is not a realistic target for the full calculation; paid Workers defaults to 30 seconds. Do not add persistent caching or deploy infrastructure without a separate decision.

The skyline does not depend on date or time. The browser should reuse the loaded response when the timeline moves. Changing observer location, height, source data, or sampling settings can require recalculation.

### Visibility and observer consistency

At each timestamp, interpolate the skyline at the body's azimuth, including interpolation across the 360/0-degree boundary. Then use the agreed body-center definition:

```ts
isVisible = elevationDeg >= terrainHorizonElevationDeg;
```

The terrain horizon can be below zero because of curvature and observer height. Do not clamp it to a flat zero-degree horizon.

- [x] Match the observer altitude used by Horizons to terrain ground height plus eye height. JPL documents the same DE421 mean-Earth observer frame and 1737.4 km sphere as the DEM; no extra rotation is needed for this combination. Timeline inputs and response-header validation prevent using a fallback lunar model. Terrain metres are converted to Horizons kilometres.
- [x] Keep body-center visibility as the initial scope. Partial disk visibility, disk size, and detailed illumination/shadow calculations are separate work.
- [x] Use the same terrain-aware visibility result in timeline JSON and CSV. The future interface should reuse these flags for statistics. The explicitly retained legacy `/api/horizon` endpoint keeps its original flat-horizon behavior.

## Reference prototype

An earlier chat reviewed `/home/ncn1/Downloads/lunar-window-v4-vscode.zip`. Treat it as a reference to inspect if available, not an installed project dependency. Its temporary extraction paths from that review are not durable resources.

The review reported:

- `terrain.js` calculates 720 directions, one every 0.5 degrees, with 240 distance samples per direction between 200 m and 120 km.
- That is 172,800 local terrain-height lookups per location, not network requests. It uses bilinear interpolation and spherical lunar curvature.
- Global terrain is LOLA LDEM_16, roughly 1.9 km spacing at the equator. Its south-pole data was reduced from 80 m to 240 m cells.
- Eye-height presets are 2, 10, and 100 m. Terrain data is bundled and calculations run in the browser.
- The surface panorama uses the terrain skyline, but timeline percentages, comparisons, and CSV exports use a uniform elevation threshold.
- The review's smooth-sphere checks supported the curvature calculation. Its synthetic nearby-ridge test exposed the 200 m sampling gap.

Reuse the useful geometry after inspection. Improve terrain resolution, include nearby terrain, and check distant sampling and search limits. More rays cannot recover detail missing from the elevation model. The reference implementation is not a final accuracy specification.

## Implementation order and open decisions

1. Complete: Earth/Sun range contracts, timestamps/time scale, limits, terrain-derived altitude, eye height, combined terrain metadata, CSV layout, and compatibility with the original single-date endpoint.
2. Complete: bounded Earth/Sun range queries and shared JSON/CSV serialization.
3. Complete: global LDEM_64/LDEM_16 calculation tiles, a 60 km LOD transition, 480 km search radius, pole handling, and tile reuse within each request. Fine terrain remains separate for rendering.
4. Complete: consistent observer altitude, frame/radius checks, and terrain-aware visibility for every timestamp and timeline export. The standalone Moon endpoint remains available.
5. Geometry, near/far ridges, peaks between rays, wraparound, poles, corrupt/missing data, source byte ranges, JSON/CSV agreement, and terrain-aware flags are checked offline. Browser timeline reuse remains pending.
6. Measure performance in the Workers runtime and decide on storage and any additional compute from those measurements.
7. Build the interactive interface when its design is supplied. Revisit shared Horizons coordination before public use.

Calculation defaults and preparation are documented in `docs/terrain.md`. The fine terrain preparers remain available for rendering work. A final accuracy target, production compute measurements, and further interface work remain open.

If caching across requests becomes necessary later, ephemeris keys must include observer position/altitude, period, interval, and relevant query settings. Skyline keys must include location, eye height, terrain dataset/version, and calculation settings. Cache persistence, capacity, and invalidation belong to that later decision, not the prototype requirements.

## Sources

- [NASA PDS global LOLA grids and product definitions](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/document/archsis.htm)
- [MIT LOLA global source archive](https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/)
- [Cloudflare Workers CPU and memory limits](https://developers.cloudflare.com/workers/platform/limits/)

- [NASA SLDEM2015 data and regional downloads](https://pgda.gsfc.nasa.gov/products/54)
- [NASA south-pole LOLA 5 m/pixel elevation mosaic](https://pgda.gsfc.nasa.gov/products/81)
- [NASA PDS north/south polar LOLA sources](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/)
- [NASA PDS polar projection equations](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/dsmap_polar.cat)
- [JPL Horizons API parameters](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [JPL observer coordinates and lunar mean-Earth frame](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [JPL API usage policy](https://ssd-api.jpl.nasa.gov/doc/index.php)
- [Moon Trek map tile API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon)

The usage policy is why upstream calls remain sequential. The decision to defer coordination across Worker instances applies to the current prototype, not a relaxed interpretation of JPL's policy.
