# Lunar terrain profiles

`GET /api/moon` calculates a terrain skyline without contacting Horizons. The
response contains `observer` and `moon.horizon`, plus the terrain provenance and
calculation settings. `/api/timeline` now uses this same terrain service to
calculate Earth/Sun visibility, while `/api/moon` remains independently available.

```sh
curl 'http://localhost:8787/api/moon?longitude=303&latitude=14'
curl -OJ 'http://localhost:8787/api/moon?longitude=303&latitude=14&format=csv'
```

## Coverage and defaults

The initial prepared region is Marius Hills, 12 to 16 degrees north and 301 to
305 degrees east. The complete search circle and its bilinear interpolation
neighbours must fit inside that region. Longitude -57 is equivalent to 303.
The centre at 14 north, 303 east supports the default 30 km search radius.
Locations outside the prepared region, including both poles, return an explicit
error. There is no coarse fallback.

These are adjustable prototype defaults, not a final accuracy specification.

| Parameter | Default | Limits |
| --- | --- | --- |
| `longitude` | Required | -180 to 360 degrees, east positive |
| `latitude` | Required | -90 to 90 degrees, north positive; prepared coverage also applies |
| `eyeHeightM` | 2 | 0.1 to 1000 metres above interpolated ground |
| `azimuthStepDeg` | 0.5 | 0.25 to 10 degrees, must divide 360 into a whole number of rays |
| `maxDistanceM` | 30000 | 100 to 120000 metres; coverage and work budgets also apply |
| `format` | `json` | `json` or `csv` |

Parameters may appear once each. Unknown parameters, duplicate parameters,
non-finite numbers and invalid sampling settings return `400 INVALID_INPUT`.
The calculation is limited to two million height samples and 48 MiB of loaded
tile data. A request may satisfy the individual parameter limits but exceed a
combined work budget or the available coverage.

## Data preparation and storage

The source is the NASA PDS SLDEM2015 product
`SLDEM2015_512_00N_30N_270_315_FLOAT`, version V2.0. It combines LOLA altimetry and
SELENE Terrain Camera data. The source label identifies the frame as mean Earth
and polar axis of DE421 and the reference sphere radius as 1737.4 km.
See the [NASA product description](https://pgda.gsfc.nasa.gov/products/54) and
[original PDS label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/sldem2015_512_00n_30n_270_315_float.lbl).

Rebuild the packaged data with Python's standard library. No GDAL or NumPy is
required.

```sh
python3 scripts/prepare-terrain.py
pnpm build
```

The preparation script downloads the detached label, validates the dimensions,
projection, frame, radius, units and encoding, then requests the crop in strips
of 128 rows using HTTP multipart byte ranges. It downloads about 16 MiB of height
values instead of the entire 1.4 GB source product. This is an offline preparation
step. The API never fetches individual height samples from NASA.

If the full source has already been downloaded, put its lowercase `.lbl` and
`.img` files in a directory and pass `--source-dir /path/to/source`. The script
also accepts `--output /path/to/terrain` for a separate output directory.

The output is sixteen 512 by 512 tiles of little-endian float32 metres, with
1 degree square coverage per tile, plus `manifest.json` and the original
`source.lbl`. Tiles are named `column-row.bin`, with columns increasing eastward
and rows increasing southward. Pixel centres are half a source cell inside tile
boundaries. Source heights are kilometres above the reference sphere; preparation
multiplies them by 1000. It does not add the sphere radius, resample, average, or
quantize heights beyond float32 metre conversion.

The manifest records geometry, source version, units, encoding and SHA-256 hashes
of every output tile, the source label, and each packed one-degree-high crop band
before unit conversion. A missing source value or an implausible height aborts
preparation. The output format reserves NaN for missing heights, and the API
rejects missing heights rather than skipping them.

Files live in `apps/web/public/terrain` and are copied to the Vite build unchanged.
Workers Static Assets serves them, with the `ASSETS` binding used by the Worker.
Each tile is 1 MiB; all height files total 16 MiB. There is no R2 bucket, database,
or persistent calculation cache. Every calculation loads and verifies its needed
tiles once and reuses the buffers for all ray samples. At the demo centre, the
default search loads eight tiles, or 8 MiB of height buffers. At this latitude,
30 km extends slightly more than a degree east and west, so a circle centred on
a tile boundary needs four tile columns and two tile rows.

## Skyline calculation

The loader samples numerical heights with bilinear interpolation across tile
boundaries. Grid spacing is 512 pixels per degree, about 59.2 m north to south;
east to west it is smaller by the cosine of latitude. This spacing does not mean
every feature of that size is resolved.

The calculation reads the observer's ground height and adds eye height. It traces
the full circle clockwise from north on the reference sphere. The first distance
sample is 1 m, or less if half a cell is smaller. Later samples are half the
smallest physical grid spacing within the search circle, up to the explicit
maximum distance, which is always included. The same radial spacing applies in
the far field. There is no 200 m exclusion and no assumption that distant terrain
cannot affect the skyline.

For each sample at surface distance `d`, with height `h`, ground-plus-eye observer
height `o`, and reference radius `R`, the local horizontal and vertical components
are:

```text
theta = d / R
forward = (R + h) * sin(theta)
up = h - o - 2 * (R + h) * sin(theta / 2)^2
elevation = atan2(up, forward)
```

The sine-squared expression avoids cancellation for nearby samples. The highest
angle on a ray sets its skyline elevation, with the distance of that sampled peak
also returned. Horizons below zero are preserved.

The search limit is a fixed distance, not a proof that farther terrain cannot
matter. Fixed angular spacing can miss narrow peaks between rays, especially far
away. Half-cell radial sampling reduces gaps along each ray, but it does not
establish a bound on skyline error. Features missing from the source DEM cannot
be recovered through denser ray sampling. No claim of metre-scale obstacle
visibility or landing-site accuracy is made.

## Response and CSV

`observer` includes normalized longitude, latitude, ground elevation, eye height
and `(groundElevationM + eyeHeightM) / 1000` as `altitudeKm` above the 1737.4 km
sphere. `moon.horizon` is ordered by azimuth, beginning at 0 degrees, with no
duplicated 360-degree row. Every row has `azimuthDeg`, `elevationDeg` and
`distanceM`. Angles are degrees and distances are metres.

`moon.terrain` is the source manifest, including its frame and integrity hashes.
`moon.calculation` records angular resolution, search distance, first sample,
radial step, samples per ray, interpolation/visibility conventions and loaded
tile count and bytes. Ground height and the skyline do not depend on a date.

CSV is an attachment produced from the same profile object as JSON. It contains
one row per azimuth, followed by repeated observer, source, frame, radius and
sampling columns. CSV calls its skyline column `terrainHorizonElevationDeg` and
its peak-distance column `peakDistanceM`. Values are not rounded. The full tile
integrity manifest is available in JSON.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid query parameters |
| 422 | `TERRAIN_OUT_OF_COVERAGE` | Search circle exceeds coverage or work/memory budget |
| 422 | `TERRAIN_MISSING_DATA` | A required height is missing or invalid |
| 503 | `TERRAIN_UNAVAILABLE` | Missing assets, unsupported manifest, failed download or corrupt tile |

## Timeline integration

`apps/api/src/terrain/service.ts` shares data loading and profile calculation
between `/api/moon` and `/api/timeline`, without making HTTP calls between routes.
`apps/api/src/terrain/profile.ts` exports `interpolateSkyline` and
`terrainVisibility`, used by the timeline and its exports. The helpers linearly
interpolate the periodic skyline, including across 360/0 degrees, and apply the
agreed body-centre rule:

```ts
isVisible = elevationDeg >= terrainHorizonElevationDeg;
```

The timeline accepts the same `eyeHeightM`, `azimuthStepDeg`, and `maxDistanceM`
parameters as the Moon endpoint. It derives `altitudeKm` from ground elevation
plus eye height and sends that height to Horizons; an independent `altitudeKm`
query parameter is rejected to avoid inconsistent observers.

JPL's [observer coordinate documentation](https://ssd.jpl.nasa.gov/horizons/manual.html#observer)
and [lunar mean-Earth frame description](https://ssd.jpl.nasa.gov/horizons/manual.html#reference-frames)
identify the Moon's high-precision observer frame as mean Earth of DE421. This
matches the prepared DEM, and both use the 1737.4 km sphere. On that sphere,
planetodetic and planetocentric latitudes coincide. No extra rotation is needed
for this combination. Horizons can fall back to the IAU lunar model outside its
high-precision interval, so the timeline accepts only years 1962 through 2649
and verifies that each upstream response identifies the Moon, a supported
mean-Earth frame (`MEAN_ME` or `MOON_ME`), and three 1737.4 km radii.

One skyline is calculated per timeline request and reused for every timestamp.
Timeline JSON includes the same `moon` object as this endpoint, plus a
`terrainHorizonElevationDeg` for each Earth/Sun row. JSON and CSV use the same
terrain-aware flags, labeled `visibilityModel: "terrain"`. Unsupported coverage
and terrain failures remain explicit errors, with no flat-horizon fallback.
The original `/api/horizon` endpoint retains its single-date, flat-horizon behavior.

Polar data preparation, additional coverage, a final accuracy target and the
interactive frontend remain future work.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
```

Terrain unit tests cover analytic sphere depression at different ground and eye
heights, a 50 m nearby ridge, a 25 km distant ridge, azimuth wraparound, tile seams,
missing heights, corrupt/truncated tiles, unsupported polar locations, work limits
and JSON/CSV agreement. The runtime test uses the packaged real SLDEM2015 data,
disables external networking, and loads it through the Worker asset binding.
Its diagnostic reports local wall time and exact loaded tile bytes. These are
not production CPU time or total isolate memory measurements.

On 2026-11-14, the default request at 14 north, 303 east took 435 ms in the local
workerd test after runtime startup. It made 756,000 height lookups and loaded
eight tiles, or 8,388,608 height bytes. The full test suite ran concurrently, so
this is one local observation rather than a latency guarantee. The same request
also succeeded against the existing Wrangler development server. This supports
keeping the initial bounded calculation in the Worker while production CPU and
total isolate memory still need measurement before deployment decisions.
