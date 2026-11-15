# Lunar Lens

Explore sunlight and Earth visibility from the lunar surface.

Lunar Lens is a web application built for the [NASA Space Apps Challenge 2026, Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/). Choose a lunar location and a UTC time range, then see how the Sun and Earth move relative to the surrounding terrain. Recent plans let you revisit different site and date combinations and compare their visibility patterns.

Near the lunar south pole, terrain can block a low Sun or Earth. Lunar Lens combines NASA/JPL Horizons positions with NASA LOLA elevation data to explore sunlight availability and opportunities for direct-to-Earth communication.

## What you can do

- Choose a site by clicking the Moon, entering coordinates, or searching presets for Marius Hills, the poles, and Apollo landing sites.
- Select a UTC date and time range, up to 366 days.
- Look around a 3D surface view with terrain, lunar imagery, and labeled Sun and Earth directions.
- Scrub or play the timeline to follow changing conditions without requesting the positions again.
- Compare visibility bars for the last 10 submitted plans. Selecting a recent plan restores its coordinates and time range.
- Retrieve terrain profiles and Sun/Earth timelines as JSON or CSV through the API.

## Using the app

1. Select **Start planning** and choose your time range. On smaller screens, continue to Location after choosing the time.
2. Pick a preset, click a point on the globe, or enter latitude and longitude. North and east are positive.
3. Select **Submit** to open the surface view. Drag to look around, or use the arrow keys. The Home key points toward Earth.
4. Use the timeline at the bottom to select a time or start playback. Hover near the bottom, focus the controls, or tap the bottom on a touch screen to reveal them.
5. Scroll back to the planner to change your inputs or restore a recent plan, then submit again.

The timeline and recent-plan bars use these colors:

| Color | Visibility |
| --- | --- |
| Green | Sun and Earth |
| Yellow | Sun only |
| Lavender | Earth only |
| Gray | Neither |

All times are UTC. The app requests hourly samples and interpolates directions between them for animation. Bar colors use the sampled visibility flags, so their boundaries have hourly resolution. A full playback takes 60 seconds.

Valid inputs and the latest surface result survive a refresh in the current tab when session storage is available. The recent-plan list clears on reload.

## Run locally

Use Node.js 22.12 or newer and pnpm 10.33.0.

```sh
pnpm install
pnpm dev
```

Open [localhost:5173](http://localhost:5173). Vite serves the frontend and proxies `/api` to the local Worker on port 8787. No Cloudflare account or NASA API key is needed for local use. Live calculations need internet access to JPL Horizons, and surface imagery needs Moon Trek. Stop both development servers with Ctrl+C.

Prepared terrain and textures are included in the repository. The two global terrain layers occupy about 541 MiB, so allow space for both the checkout and build output.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start frontend and API development servers |
| `pnpm build` | Build the frontend and bundle the Worker without publishing |
| `pnpm preview` | Build and serve the combined application locally on port 5173 |
| `pnpm start` | Serve an existing build on port 5173 |
| `pnpm test` | Build and run the frontend and API tests |
| `pnpm typecheck` | Check TypeScript across the workspace |
| `pnpm lint` | Run the configured lint checks |

`pnpm preview` and `pnpm start` serve the combined build without hot reload. Stop the development servers first because they use the same frontend port. For an existing build, `HOST` and `PORT` can override the defaults, for example `HOST=127.0.0.1 PORT=8080 pnpm start`. Development and preview listen on the local network by default.

The automated tests use captured NASA fixtures and packaged terrain. They do not contact the live NASA services.

## How it works

The frontend uses React, TypeScript, Vite, Three.js, and GSAP with a Catppuccin Mocha theme. A Hono API runs on Cloudflare Workers and serves the frontend through Workers Static Assets. Astronomy Engine supplies the home globe's orientation and lighting, plus apparent body sizes in the surface view. Surface Sun and Earth directions come from Horizons.

```text
apps/web/           Frontend and packaged lunar assets
apps/api/           API routes, terrain calculations, and tests
packages/contracts/ Shared request and response types
scripts/            Offline terrain and texture preparation
docs/               API reference and resource guide
moon_horizon.py     Original single-date, flat-horizon utility
```

## Interpreting the results

Visibility means the center of the Sun or Earth is on or above the calculated terrain skyline. It describes geometric sunlight and line of sight. It does not calculate electrical power output, battery endurance, or radio-link quality.

Terrain resolution and the fixed search radius limit the skyline calculation. The rendered surface covers a local area, while the API searches terrain out to 480 km by default. Photographic imagery contains its original lighting, so the rendered shadows are illustrative. See the [resource guide](docs/resources.md) for data provenance and calculation limits.

## Documentation

- [API reference](docs/api.md) covers endpoints, parameters, JSON/CSV output, and errors.
- [Resources and data access](docs/resources.md) lists the services the app contacts, packaged datasets, source credits, and regeneration commands.

## Deployment

The Worker configuration includes the custom domain `nasa.nitescutudor.ro`. To publish using the Cloudflare account that manages that domain:

```sh
pnpm --filter @lunar-lense/api exec wrangler login
pnpm run deploy
```

This uploads both the API and frontend. The frontend and `/api` share an origin. The API reference describes the current [upstream coordination and runtime behavior](docs/api.md#runtime-behavior).
