# API reference

Lunar Lens serves its API under `/api` on the same origin as the frontend. During `pnpm dev`, it is also available directly at `http://localhost:8787`. With `pnpm preview` or `pnpm start`, use port 5173 instead.

| Method | Endpoint | Returns |
| --- | --- | --- |
| GET | `/api/health` | Service status |
| GET | `/api/timeline` | Terrain-aware Sun and Earth positions over time, as JSON or CSV |
| GET | `/api/moon` | Terrain skyline and observer metadata, as JSON or CSV |
| GET | `/api/horizon` | Legacy single-date positions against a flat horizon |
| GET | `/api/imagery/layers/wac-global` | Moon Trek imagery metadata |
| GET | `/api/imagery/tiles/wac-global/{z}/{x}/{y}` | Original JPEG tile bytes |

Coordinates are lunar latitude, north positive, and longitude, east positive. Azimuth runs clockwise from north in `[0, 360)`. Elevation is in degrees above the local horizontal, in `[-90, 90]`. Bodies below the horizon remain in position responses.

## Timeline and CSV downloads

```sh
curl 'http://localhost:8787/api/timeline?start=2026-11-14&end=2026-11-15&longitude=303&latitude=14&stepMinutes=60&eyeHeightM=2'
```

This returns 25 hourly samples per body, including midnight at both ends, and one shared terrain skyline.

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

Global coverage includes both poles and the longitude seam. Terrain tiles are loaded and verified once per request, then reused for one skyline and every timestamp. Searches up to 60 km use only LDEM_64; larger searches add LDEM_16. The API reads packaged terrain rather than requesting individual heights from NASA. Far-field cell envelopes cover gaps between rays and can overestimate an obstruction's angular extent. Missing or corrupt calculation data fails explicitly, with no flat-horizon fallback.

For example, request the north-pole timeline or the standalone south-pole skyline:

```sh
curl 'http://localhost:8787/api/timeline?start=2026-11-15&end=2026-11-16&longitude=0&latitude=90'
curl 'http://localhost:8787/api/moon?longitude=0&latitude=-90'
```

`moon.terrain` describes the global LOD model and lists each source under `layers`, including its resolution, active distance band, encoding, source hashes, and loaded bytes. Full tile hash indices stay in the asset manifests. At either exact pole, the model uses the mean of the closest complete LDEM_64 latitude ring for one longitude-independent ground height. Supplied longitude still defines the azimuth reference and is used consistently by the skyline and Horizons.

`altitudeKm` is computed from interpolated ground elevation plus `eyeHeightM`, and the same altitude is sent to Horizons. It is not accepted as an independent query parameter. Both calculations use the DE421 lunar mean-Earth frame and a 1737.4 km reference sphere. JPL documents that observer frame in its [coordinate definitions](https://ssd.jpl.nasa.gov/horizons/manual.html#observer) and [lunar frame description](https://ssd.jpl.nasa.gov/horizons/manual.html#reference-frames). Timeline dates are restricted to 1962 through 2649 to stay within UTC and the high-precision lunar model's interval. The parser also checks each NASA response's observer frame and spherical radii, and rejects incompatible or fallback models.

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

Both formats use the same dataset and visibility rules. The full skyline is available in timeline JSON or through `/api/moon`, whose CSV contains one row per compass direction. Errors remain JSON without an attachment header.

## Terrain skyline

```sh
curl 'http://localhost:8787/api/moon?longitude=303&latitude=14'
curl -OJ 'http://localhost:8787/api/moon?longitude=0&latitude=-90&format=csv'
```

`/api/moon` accepts only the coordinate and terrain parameters below, plus `format`. It does not accept time parameters or contact Horizons. `/api/timeline` uses the same terrain service directly, without an internal HTTP call.

Calculations use two global NASA LOLA grids, including both poles and the longitude seam. Neither calculation endpoint reads the retained fine Marius Hills or polar assets, or requests individual height samples from NASA.

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

Provided parameters must appear exactly once. Unknown or repeated parameters, non-finite numbers and invalid settings return `400 INVALID_INPUT`. Requests up to 60 km use only LDEM_64; larger requests also load LDEM_16. The default returns 2,880 azimuth rows, starting at north without a duplicate 360-degree row.

### Terrain response

The top-level response contains `observer` and `moon`. Observer fields are `body`, normalized `longitudeDeg`, `latitudeDeg`, `groundElevationM`, `eyeHeightM`, and `altitudeKm`. Altitude is `(groundElevationM + eyeHeightM) / 1000` above the reference sphere.

`moon.horizon` contains `azimuthDeg`, `elevationDeg`, and `distanceM` for each direction. Angles are degrees and distances are metres.

`moon.terrain` has `format: "lunar-dem-lod-v1"`, a model ID, common source/frame metadata, and `layers`. Each layer includes its source version/URL and hashes, geometry/encoding, `minDistanceM`, `maxDistanceM`, `distanceStepM`, `loadedTileCount`, and `loadedBytes`. Full tile hash indices stay in each static asset manifest rather than being repeated in every response. Only active layers are included.

`moon.calculation` reports sampling settings and work counts. `distanceStepM` is the near step; each layer reports its own step. `samplesPerAzimuth` counts the complete near/far ray schedule. `farFieldCoverage: "cell-envelope"` and `farCellCount` describe the extra far-field pass when present. Loaded bytes count retained terrain tile buffers, not total isolate memory.

Moon CSV has one row per azimuth, with repeated source, observer, and calculation settings. Source-band columns include `nearSourceProduct`, `nearMaxDistanceM`, `nearPixelsPerDegree`, `farSourceProduct`, `farPixelsPerDegree`, and `farDistanceStepM`. Single-source `pixelsPerDegree` is blank for the combined model. The complete header is defined in [the CSV serializer](../apps/api/src/terrain/csv.ts). Both formats serialize the same profile and flags; errors remain JSON without an attachment header.

### Skyline calculation

The observer height is always LDEM_64 interpolated ground plus eye height. The calculation starts at 1 m, uses half-grid radial steps per level, and includes the 60 km transition and final endpoint. It uses bilinear height interpolation across tile boundaries. The dataset switches after 60 km without blending the two sources; the metadata reports both active bands.

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

At an exact pole, the model uses the mean of the nearest complete LDEM_64 latitude ring for one longitude-independent ground height, then interpolates through the remaining polar cap. Supplied longitude defines the azimuth basis consistently with Horizons. Longitude wraps during interpolation and tile selection.

See [resources and data access](resources.md) for source products, preparation, and display limits.

## Legacy single-date positions

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

This endpoint does not use terrain. The planner uses `/api/timeline` instead.

## Surface imagery

### Layer metadata

Request:

```http
GET /api/imagery/layers/wac-global
```

JSON response for the verified Moon Trek layer:

```json
{
  "id": "wac-global",
  "source": "Moon Trek",
  "sourceLayer": "LRO_WAC_Mosaic_Global_303ppd_v02",
  "projection": "equirectangular",
  "nativeCrs": "urn:ogc:def:crs:EPSG::104903",
  "longitudeConvention": "east-positive",
  "boundsDeg": { "west": -180, "south": -90, "east": 180, "north": 90 },
  "tileSize": 256,
  "minZoom": 0,
  "maxZoom": 8,
  "matrixSet": "default028mm",
  "scheme": "xyz",
  "levelZeroColumns": 2,
  "levelZeroRows": 1,
  "contentType": "image/jpeg",
  "tileUrlTemplate": "/api/imagery/tiles/wac-global/{z}/{x}/{y}",
  "appearance": "photographic",
  "credit": "NASA / LRO / LROC; served by Moon Trek"
}
```

For this layer, each zoom doubles both matrix dimensions. Columns increase
eastward from -180 degrees and rows southward from +90 degrees. This is a
geographic grid, not Web Mercator. Convert our terrain's 0 to 360 degrees longitudes when
selecting imagery tiles.

Only `wac-global` is registered.

### Image tiles

Request:

```http
GET /api/imagery/tiles/wac-global/{z}/{x}/{y}
```

The API returns the original image bytes with `Content-Type: image/jpeg`. It resolves the known layer ID server-side to:

```text
https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg
```

The upstream path has **row before column**, while our route has
**x before y**. Integer coordinates are validated against the layer's matrix
size. Only registered layer IDs resolve to fixed source endpoints. Unknown
layers return `404`; caller query parameters are not forwarded upstream, and
upstream redirects are rejected.

The upstream request, including its body, has a 15-second timeout. Failures use the shared [JSON error envelope](#errors).

The API finishes downloading each tile before sending image headers so failed
body downloads still return JSON. Only the original image bytes and the layer's
content type are returned; upstream cookies and attachment headers are omitted.
Caller cancellation is forwarded to the upstream request. The surface view limits each download batch to four concurrent requests and cancels outstanding work when the scene is replaced.

## Health

`GET /api/health` returns `{"status":"ok"}` without contacting NASA. It confirms that the API responds, not that upstream services are available.

## Errors

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Provide start, end, longitude and latitude exactly once, with no unknown or repeated parameters."
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
| 502 | `HORIZONS_ERROR` | Upstream HTTP, network, JSON, frame, or ephemeris failure |
| 504 | `HORIZONS_TIMEOUT` | An upstream request exceeded 45 seconds |
| 502 | `IMAGERY_ERROR` | Imagery HTTP/network failure, wrong content type, empty image, or body download failure |
| 504 | `IMAGERY_TIMEOUT` | An imagery request, including its body, exceeded 15 seconds |
| 500 | `INTERNAL_ERROR` | Unexpected application failure |

## Runtime behavior

A successful timeline calculates one skyline and makes two sequential Horizons range requests, Earth then Sun. It does not make two requests per timestamp. Required terrain tiles are loaded once per request and checked against manifest hashes. Missing or corrupt terrain fails explicitly, without a flat-horizon fallback.

Horizons calls are serialized across callers within one Worker instance. This queue does not coordinate separate Cloudflare instances. There is no persistent result cache, distributed queue, database, or object-storage binding. The existing deployment therefore does not enforce [JPL's concurrency policy](https://ssd-api.jpl.nasa.gov/doc/index.php) across instances.

Each new JSON or CSV request recalculates the skyline and requests ephemerides again. A pair of Horizons calls can take about 90 seconds to time out, plus queue waiting and terrain computation. The browser's timeline playback uses positions already loaded for the latest submission.

Loaded terrain bytes report retained tile buffers, not total runtime memory. Local timing measurements do not establish production CPU or total memory usage. Deployment capacity must be assessed against [Workers runtime limits](https://developers.cloudflare.com/workers/platform/limits/).

Shared response types are in [packages/contracts](../packages/contracts/src/index.ts), with [timeline types](../packages/contracts/src/timeline.ts), [terrain types](../packages/contracts/src/terrain.ts), and [imagery types](../packages/contracts/src/imagery.ts).
