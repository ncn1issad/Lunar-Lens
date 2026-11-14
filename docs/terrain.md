# Lunar terrain calculations

`GET /api/moon` returns a terrain skyline and observer metadata without contacting Horizons. `/api/timeline` uses the same service for Earth/Sun visibility and retains the standalone Moon endpoint. Both offer JSON and a `format=csv` attachment.

```sh
curl 'http://localhost:8787/api/moon?longitude=303&latitude=14'
curl -OJ 'http://localhost:8787/api/moon?longitude=0&latitude=-90&format=csv'
curl 'http://localhost:8787/api/timeline?longitude=0&latitude=90&start=2026-11-15&end=2026-11-16'
```

## Coverage and settings

Calculations use two global NASA LOLA grids, including both poles and the longitude seam. Fine Marius Hills and polar terrain is reserved for rendering. Neither calculation endpoint reads those fine assets or requests individual height samples from NASA.

| Distance from observer | Calculation source | North/south grid spacing | Radial step |
| --- | --- | --- | --- |
| 0 to 60 km | LDEM_64 V3.1 | 473.8 m | 236.9 m |
| Over 60 to 480 km | LDEM_16 V3.1 | 1.895 km | 947.6 m |

Grid spacing is a resolution, not a terrain accuracy guarantee. East/west spacing decreases with latitude. The radial steps above use the fixed north/south spacing so cylindrical convergence near a pole does not cause unbounded ray work. Far-field cell envelopes cover represented terrain between rays.

| Parameter | Default | Accepted values |
| --- | --- | --- |
| `longitude` | Required | -180 to 360 degrees, east positive |
| `latitude` | Required | -90 to 90 degrees, north positive |
| `eyeHeightM` | 2 | 0.1 to 10 metres above the LDEM_64 interpolated ground |
| `azimuthStepDeg` | 0.125 | 0.125 to 10 degrees; must divide 360 into a whole number of directions |
| `maxDistanceM` | 480000 | 100 to 480000 metres, measured as a radius along the reference sphere |
| `format` | `json` | `json` or `csv` |

Parameters must appear once each. Unknown or repeated parameters, non-finite numbers and invalid settings return `400 INVALID_INPUT`. Requests up to 60 km use only LDEM_64; larger requests also load LDEM_16. The default returns 2,880 azimuth rows, starting at north without a duplicate 360-degree row.

## Global data preparation

The sources are LDEM_64 and LDEM_16 V3.1, with pixel-centre registration in the MOON_ME_DE421 frame and a 1737.4 km reference sphere. The source label gives native signed little-endian int16 digital numbers, scaled by 0.5 metres. Height above the sphere is `DN * 0.5`; adding the label's radius offset would instead produce a planetary radius and is incorrect for our height field.

See the [NASA grid specification](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/document/archsis.htm), [PDS source archive](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/) and [MIT LOLA archive](https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/).

```sh
python3 scripts/prepare-global-terrain.py --source-dir /tmp/lunar-lense-global-source
pnpm build
```

The standard-library-only preparer validates dimensions, version, projection, frame, radius, scale, projection offsets and global bounds. It downloads the canonical PDS labels, then checks that the default MIT mirror has byte-identical labels. `--mirror pds` downloads images directly from PDS. Image transfers use eight resumable 4 MiB range requests at a time, checking status, Content-Range and byte counts. Retaining `--source-dir` lets interrupted downloads resume. Use `--level 64` or `--level 16` for one grid and `--output` for a different destination.

| Source | Dimensions | Original bytes | Prepared tiles | Prepared height bytes |
| --- | --- | --- | --- | --- |
| LDEM_64 | 23040 by 11520 | 530,841,600 | 4,050 | 506.25 MiB |
| LDEM_16 | 5760 by 2880 | 33,177,600 | 276 | 34.5 MiB |

Tiles are 256 by 256 native int16 values, 131,072 bytes each. Together the prepared layers occupy 540.75 MiB plus labels/manifests. Original source downloads are about 537.9 MiB. These are whole-Moon storage sizes, not per-request memory requirements.

Outputs live under `apps/web/public/terrain/ldem_64` and `ldem_16`. Vite copies them unchanged to its build, and the Worker reads them through ASSETS. There is no R2 bucket, database, persistent result cache, or runtime NASA terrain download.

Each source manifest records SHA-256 hashes for the original image, label, source row bands, and prepared tiles. No resampling or float32 conversion occurs during preparation. Edge padding is reserved -32768; image dimensions exclude it from sampling. Missing original heights abort preparation. The manifest is written last. At runtime, every needed tile is loaded once and verified before use. Native buffers are retained without a float32 copy, with a combined 48 MiB buffer limit.

## Pole and longitude handling

Longitude wraps across zero during tile selection and interpolation. Tile selection includes interpolation neighbours and handles LDEM_16's partial final tile column and row.

The first and last source rows lie half a grid step inside the poles. The model defines a single pole height as the mean of the complete nearest latitude ring, then interpolates between that height and the first/last row in the small remaining cap. This produces one ground elevation at each pole regardless of observer longitude. It is an approximation of the cylindrical model, not a measured point height from fine polar terrain.

Independent original LDEM_64 row samples give pole heights of -12.800933159722222 m north and 1196.0204210069444 m south. The references and full-ring hashes are stored in `apps/api/test/fixtures/global-reference.json`. The different fine-polar heights in the older `polar-reference.json` belong to the separate rendering source.

At an exact pole, supplied longitude defines the local north/east convention. The API uses it consistently for skyline directions and the Horizons observer.

## Skyline calculation

The observer height is always LDEM_64 interpolated ground plus eye height. The calculation starts at 1 m, uses half-grid radial steps per level, and includes the 60 km transition and final endpoint. It uses bilinear height interpolation across tile boundaries. There is no 200 m exclusion. The dataset switches after 60 km without blending the two sources; the metadata reports both active bands.

For surface distance `d`, terrain height `h`, ground-plus-eye observer height `o`, and reference radius `R`, the local components are:

```text
theta = d / R
forward = (R + h) * sin(theta)
up = h - o - 2 * (R + h) * sin(theta / 2)^2
elevation = atan2(up, forward)
```

The sine-squared expression avoids cancellation near the observer. The largest apparent angle sets the skyline. Negative skyline angles remain negative. Trigonometry that depends only on distance or observer latitude is shared across rays.

The far field also visits each intersecting LDEM_16 pixel region. A circular envelope around the region bounds its distance and angular extent. Its source height contributes the maximum apparent angle within that distance interval to both bounding rays and every ray between them. For a height below the observer, the interval maximum can occur at the tangent distance rather than its nearest edge. Bounding both rays keeps periodic interpolation covered between samples.

This cell-envelope step is conservative about the outline of represented far terrain and can overestimate occlusion. A returned far-field `distanceM` can describe an envelope extremum rather than an exact sampled peak location. NASA grids contain means and can smooth away narrow terrain; neither extra rays nor envelopes recover missing source detail. Nearby sampling is approximate too. The fixed 480 km cutoff is a prototype choice, not a proof that no farther terrain can matter for every possible terrain geometry.

Ray work is capped at three million samples, and the far-cell pass at two million cells. The default ray count is about two million samples; polar far-cell coverage costs more than an equatorial patch. The skyline does not depend on date and is reused for every timestamp in a timeline request.

## JSON and CSV

The top-level response retains `observer` and `moon`. Observer fields are `body`, normalized `longitudeDeg`, `latitudeDeg`, `groundElevationM`, `eyeHeightM`, and `altitudeKm`. Altitude is `(groundElevationM + eyeHeightM) / 1000` above the reference sphere.

`moon.horizon` contains `azimuthDeg`, `elevationDeg`, and `distanceM` for each direction. Angles are degrees and distances are metres.

`moon.terrain` has `format: "lunar-dem-lod-v1"`, a model ID, common source/frame metadata, and `layers`. Each layer includes its source version/URL and hashes, geometry/encoding, `minDistanceM`, `maxDistanceM`, `distanceStepM`, `loadedTileCount`, and `loadedBytes`. Full tile hash indices stay in each static asset manifest rather than being repeated in every response. Only active layers are included.

`moon.calculation` retains its existing fields. `distanceStepM` is the near step; each layer reports its own step. `samplesPerAzimuth` counts the complete near/far ray schedule. `farFieldCoverage: "cell-envelope"` and `farCellCount` describe the extra far-field pass when present. Loaded bytes count retained terrain tile buffers, not total isolate memory.

Moon CSV remains one row per azimuth, with repeated source/observer/settings columns. It appends `nearSourceProduct`, `nearMaxDistanceM`, `nearPixelsPerDegree`, `farSourceProduct`, `farPixelsPerDegree`, and `farDistanceStepM` to the previous columns. Single-source `pixelsPerDegree` is blank for the combined model. Timeline CSV keeps its previous columns. Both formats serialize the same profile and flags; errors remain JSON without an attachment header.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid parameters |
| 422 | `TERRAIN_OUT_OF_COVERAGE` | Work or buffer budget exceeded |
| 422 | `TERRAIN_MISSING_DATA` | A required height is missing or invalid |
| 503 | `TERRAIN_UNAVAILABLE` | Absent or invalid manifest, missing tile, or integrity failure |

## Timeline integration

Both endpoints use `apps/api/src/terrain/service.ts`, without an HTTP call between them. The timeline sends the calculated observer altitude to Horizons. Independent `altitudeKm` input is rejected. `interpolateSkyline` handles periodic interpolation across north and `terrainVisibility` applies:

```ts
isVisible = elevationDeg >= terrainHorizonElevationDeg;
```

JPL's [observer coordinates](https://ssd.jpl.nasa.gov/horizons/manual.html#observer) and [lunar frame description](https://ssd.jpl.nasa.gov/horizons/manual.html#reference-frames) identify the same DE421 mean-Earth observer frame. Both calculations use the 1737.4 km sphere, where planetodetic and planetocentric latitudes coincide. No extra rotation is needed. Timeline dates stay in 1962 through 2649, and NASA response headers must identify the Moon, the high-precision mean-Earth model and matching spherical radii.

One skyline feeds the full timeline and CSV export. Successful timelines still make only two sequential Horizons range calls, Earth then Sun. Terrain failures occur before these calls. There is no flat-horizon fallback. The explicitly retained `/api/horizon` endpoint keeps its original single-date behavior.

## Fine terrain retained for rendering

The existing fine files are separate from calculation data. `scripts/prepare-terrain.py` prepares Marius Hills SLDEM2015 V2.0 at 512 pixels per degree, covering 12 to 16 north and 301 to 305 east. Its sixteen 512 by 512 float32 metre tiles total 16 MiB under `public/terrain`.

`scripts/prepare-polar-terrain.py` prepares LDEM_80N_80M V2.1 and LDEM_80S_80M V2.0. Both use 7600 by 7600 native int16 values, 0.5 m height scaling, and 80 m projected spacing. Each output cap has 225 tiles of 512 by 512 values; both total 225 MiB under `public/terrain/north` and `south`. Coverage is bounded to 80 to 90 north/south. Use `--pole`, `--source-dir`, or `--output` to control preparation. The source labels and all hashes are preserved.

Their polar stereographic projection follows [PDS equations](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/dsmap_polar.cat). With hemisphere sign `s` and radian angles:

```text
rho = 2 * R * tan((pi/2 - s * latitude) / 2)
x = rho * sin(longitude)
y = -s * rho * cos(longitude)
column = (x + 304000) / 80 - 0.5
row = (304000 - y) / 80 - 0.5
```

The pole lies between the four central pixels, at zero-based 3799.5. Internal regional loader tests remain as checks of these retained files and equations. They do not select the data used by `/api/moon` or `/api/timeline`. No fine-terrain rendering integration is implied by retaining the data.

## Verification and deployment limits

```sh
pnpm test
pnpm typecheck
pnpm lint
```

Offline tests cover analytic curvature, nearby terrain, the LOD boundary, a mountain beyond 240 km, a peak between coarse test rays, global wraparound and pole crossings, native encoding, source byte references, corrupt/missing assets, query limits, and JSON/CSV visibility agreement. The bundled Worker test loads real global assets through ASSETS with network access disabled. Its diagnostics report local wall time, ray/cell counts, and retained tile bytes.

On 2026-11-15, all 64 API tests passed against the build with all 4,326 global tiles. The build, type checking, lint and full tile/source hash checks also passed. Local workerd observations for default settings were:

| Observer | Wall time | Retained terrain buffers | Ray samples | Far cells |
| --- | --- | --- | --- | --- |
| 14 north, 303 east | 506 ms | 1.625 MiB | 2,013,120 | 206,528 |
| Equator, 0 east | 526 ms | 1.375 MiB | 2,013,120 | 200,332 |
| North pole | 877 ms | 14.125 MiB | 2,013,120 | 1,284,480 |
| South pole | 795 ms | 17 MiB | 2,013,120 | 1,284,480 |
| 88.02 north, 123 east | 852 ms | 17 MiB | 2,013,120 | 1,347,364 |

These are single local observations after runtime startup, with other tests running concurrently. They exclude live Horizons waiting time and do not measure production CPU or total isolate memory. The north/south buffer difference comes from tile boundaries in the cylindrical files.

[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) allow 128 MB per isolate. Workers Free allows 10 ms CPU per request; paid Workers defaults to 30 seconds and can be configured higher. The full terrain calculation is not designed for the free CPU allowance. Local wall time and tile-buffer measurements do not establish production CPU or total isolate memory usage. Hosting changes, deployment, persistent caching and distributed Horizons coordination remain separate decisions.
