# Lunar Lense plans

This file records the project decisions and terrain discussions through 2026-11-14. Use it with [README.md](README.md) instead of searching earlier chats. The README documents the running application; this file describes planned work. Unchecked items are not implemented.

## Current implementation

- A pnpm workspace with `apps/api`, `apps/web`, and `packages/contracts`.
- A Hono API on Cloudflare Workers. The earlier Fastify implementation was migrated to Hono.
- A Vite, React, and TypeScript frontend served through Workers Static Assets, with a Three.js Moon globe on a black background. Drag rotation and scroll/pinch zoom are implemented. The NASA LROC texture is packaged locally; the globe currently uses spherical geometry without terrain displacement.
- The home page uses Astronomy Engine and the browser clock for current sunlight and lunar orientation, with a lunar-north-up Earth-centred starting view. It refreshes each minute and on tab return without resetting camera controls. No location or new API endpoint is used. Time-based lighting is opt-in through the globe's `live` prop.
- `GET /api/horizon` accepts a date and lunar longitude/latitude, then returns one midnight sample for Earth and the Sun.
- `GET /api/timeline` accepts a start/end, coordinates, sampling interval, and terrain settings. It returns aligned Earth/Sun tables with terrain-aware visibility and a shared `moon` profile as JSON, or the combined position table as a `format=csv` attachment. See the README for the implemented contract and limits.
- Each timeline row has `timestamp`, `azimuthDeg`, `elevationDeg`, `terrainHorizonElevationDeg`, and `isVisible`. Visibility compares the body's center against the interpolated terrain skyline. Disk size is not included. The legacy `/api/horizon` endpoint still compares elevation with zero.
- Observer altitude is fixed at 0 km for `/api/horizon`; `/api/timeline` derives altitude from terrain ground elevation plus `eyeHeightM` (default 2 m). An independent `altitudeKm` input is rejected.
- Horizons calls are sequential within one Worker instance. There is no result cache or coordination across instances.
- `GET /api/moon` independently returns a `moon.horizon` profile and observer height metadata as JSON or CSV. Prepared native-resolution SLDEM2015 tiles cover Marius Hills, 12 to 16 degrees north and 301 to 305 degrees east. Both endpoints share `apps/api/src/terrain/service.ts`. See [terrain documentation](docs/terrain.md) for preparation, sampling, errors, and verification.
- No Durable Objects, SQLite databases, or persistent result caches are configured.

## Agreed architecture and scope

Keep Hono on Cloudflare Workers and the Vite frontend on Workers Static Assets. The initial deployment shares an origin, with `/api` and `/api/*` routed to the Worker. Keep the workspace packages separate so independent deployments remain possible later.

The project has a short deadline. Prioritize a working implementation and measure performance before adding more infrastructure. The current scope is a private, mostly single-user prototype. Shared upstream coordination and Durable Objects were explicitly deferred. Keep the existing sequential calls within each instance; this deferral does not provide coordination across the deployment.

For this prototype, reuse data already loaded for the current calculation or browser session. Do not add a persistent result cache, a cache database, or a separate caching service. New API requests may fetch ephemerides and recalculate the skyline. Revisit caching across requests only if measured performance or repeated upstream calls justify it. Prepared terrain files are application input data, not a result-cache system.

The eventual interface should support an interactive Moon, Earth and Sun visuals, a timeline, and a transition between orbital and surface views. Those graphics run in the browser. They do not by themselves justify SSR or a move to Next.js. The first interface step is implemented with Three.js: only a textured Moon globe on black, with rotation and zoom. Additional controls, terrain displacement, and surface views remain future work.

## Target API behavior

- [x] Return a `moon` object containing a table of the terrain horizon around the observer, with horizon elevation at each sampled azimuth, through the separate bounded `/api/moon` prototype.
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

The timeline contract accepts dates or UTC timestamps in years 1962 through 2649, spans at most 366 days, and returns at most 10,000 samples per body. The dates stay within UTC and the supported high-precision DE421 mean-Earth observer frame interval. Upstream headers are also checked for the lunar frame and 1737.4 km spherical radii. Steps are whole minutes, defaulting to 60. The start is included; the end is included only when it falls on the sample grid. Bodies below the skyline remain in the tables. Historical UT1 queries remain available through the original single-date endpoint. The timeline reports `visibilityModel: "terrain"`. Unsupported terrain coverage fails explicitly before any NASA call.

## Terrain data and skyline calculation

### Data access

Terrain sampling means reading numerical heights from loaded elevation data. It does not mean making one NASA API request per direction or terrain point. Moon Trek image tiles can provide visual textures, but rendered elevation colors are not a substitute for numerical heights.

The agreed approach is to download elevation data once, prepare it for the application, and reuse it. NASA publishes downloadable grids and regional tiles. The initial implementation packages one-degree square, 512 by 512 float32 metre tiles through Workers Static Assets. Prepared data is application input, not a persistent calculation cache.

Candidate sources discussed:

| Area | Candidate data | Notes |
| --- | --- | --- |
| Within 60 degrees south to 60 degrees north | SLDEM2015 | About 60 m grid spacing at the equator at 512 pixels per degree. Grid spacing does not guarantee that every feature of that size is resolved. |
| Polar regions | Suitable LOLA elevation models | Select products according to their actual coverage and resolution. A 5 m/pixel south-pole product covers 87 to 90 degrees south; it does not cover all polar locations. |

- [x] Choose initial coverage with an explicit error for unsupported areas. Marius Hills uses native 512 pixels/degree SLDEM2015 with no coarse fallback. A final accuracy target and wider/polar coverage remain open.
- [x] Build a repeatable data-preparation process and record provenance, units, projection, reference frame, reference radius, resolution, and missing-data conventions. `scripts/prepare-terrain.py` validates the source label and records source/output hashes.
- [x] Load the tiles needed for the observer's surroundings and search distance. Fetch tiles as units, never individual height samples.
- [x] Reuse loaded tiles throughout the current calculation instead of fetching them for individual samples. A cache across requests is deferred.

### Calculation

For a fixed observer location and eye height:

1. Read ground elevation from the elevation model and add eye height above ground.
2. Trace outward in compass directions around the full 360 degrees.
3. Read terrain heights along each direction, interpolating grid values as appropriate.
4. Calculate each sample's apparent vertical angle relative to the observer's local horizontal, accounting for lunar curvature.
5. Keep the highest angle in each direction. These angles form the skyline profile.

This is a reasonable initial algorithm, not a claim that fixed ray sampling is optimal. It can revisit the same nearby grid cells and miss narrow peaks between distant samples.

- [x] Implement resolution-based radial sampling with nearby terrain. The first sample is 1 m, followed by half-cell steps, with an adjustable 0.5-degree default azimuth step. A final angular accuracy target remains open.
- [ ] Evaluate finer data/sampling nearby and coarser data farther away, without assuming distant peaks cannot matter.
- [x] Make the maximum search distance explicit. The default is 30 km, bounded by coverage and work limits. There is no adaptive stopping claim; terrain beyond that distance may still matter.
- [ ] Measure production CPU time and total isolate memory before finalizing compute. The initial real-data local workerd check took 435 ms wall time for 756,000 lookups and loaded 8 MiB of terrain buffers. Keep the bounded prototype in the Worker for now; these measurements do not establish production CPU or total memory usage.
- [x] Calculate one skyline per observer configuration in the request and reuse it for every timestamp. A cache across requests is deferred.

The geometric skyline does not change when the selected date or time changes. Calculate it once for a fixed observer and reuse it across the whole Earth/Sun time series. Changing location, height, source data, or calculation settings can require recalculation.

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
3. Complete for the bounded prototype: selected Marius Hills coverage, prepared representative SLDEM2015 tiles, and implemented the skyline calculation with tile reuse within the request.
4. Complete: consistent observer altitude, frame/radius checks, and terrain-aware visibility for every timestamp and timeline export. The standalone Moon endpoint remains available.
5. Terrain geometry, nearby/distant ridges, azimuth wraparound, missing/corrupt data, combined JSON/CSV agreement, and visibility changes on both sides of zero elevation are verified. Polar locations explicitly return unsupported coverage. Verifying future polar data and browser timeline reuse remains pending.
6. Measure performance in the Workers runtime and decide on storage and any additional compute from those measurements.
7. Build the interactive interface when its design is supplied. Revisit shared Horizons coordination before public use.

Initial terrain choices are documented in `docs/terrain.md`: Marius Hills coverage, float32 metre tiles on Static Assets, 2 m default eye height, 0.5-degree default skyline spacing, and a 30 km default search distance. These are adjustable prototype settings, not an approved final accuracy specification. The combined terrain/time-series contract and matching observer frame are now implemented. Wider and polar coverage, a final accuracy target, production compute requirements, and graphics engine remain open.

If caching across requests becomes necessary later, ephemeris keys must include observer position/altitude, period, interval, and relevant query settings. Skyline keys must include location, eye height, terrain dataset/version, and calculation settings. Cache persistence, capacity, and invalidation belong to that later decision, not the prototype requirements.

## Sources

- [NASA SLDEM2015 data and regional downloads](https://pgda.gsfc.nasa.gov/products/54)
- [NASA south-pole LOLA 5 m/pixel elevation mosaic](https://pgda.gsfc.nasa.gov/products/81)
- [JPL Horizons API parameters](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [JPL observer coordinates and lunar mean-Earth frame](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [JPL API usage policy](https://ssd-api.jpl.nasa.gov/doc/index.php)
- [Moon Trek map tile API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon)

The usage policy is why upstream calls remain sequential. The decision to defer coordination across Worker instances applies to the current prototype, not a relaxed interpretation of JPL's policy.
