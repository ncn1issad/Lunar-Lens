# Surface imagery API

Implemented 2026-11-15. These endpoints supply imagery metadata and image tiles
for surface views. An initial [fixed surface preview](surface-preview.md) is
implemented; connecting the scene to the planning inputs remains pending.

## Sources and responsibilities

- Terrain geometry: keep the project's existing elevation dataset and its
  expanding regional/polar coverage. The renderer needs the numerical tiles,
  not only the calculated skyline returned by `/api/moon`.
- Surface imagery: request Moon Trek or QuickMap imagery through the API as
  tiles become visible. Prefer a global base layer, with additional regional
  and polar layers where useful.
- Earth/Sun positions: keep the existing JPL Horizons timeline integration.

An image tile is independent of the requested timeline date. The browser can
reuse loaded tiles while scrubbing time. This implementation adds no persistent
result cache or full-Moon imagery download.

## Layer metadata

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
geographic grid, not Web Mercator. Convert our terrain's 0–360 longitudes when
selecting imagery tiles.

Additional layer IDs can use the same image endpoint. Polar or irregular tile
matrices need their native CRS, coverage and matrix definitions, rather than
assuming this geographic grid applies to every source. A list endpoint can
follow when the interface needs layer selection.

## Image tiles

Request:

```http
GET /api/imagery/tiles/wac-global/{z}/{x}/{y}
```

Return the original image bytes with `Content-Type: image/jpeg`. Keep binary
images separate from timeline JSON; base64 encoding is unnecessary.

Resolve the known layer ID server-side to:

```text
https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg
```

The upstream path has **row before column**, while our route has
**x before y**. Integer coordinates are validated against the layer's matrix
size. Only registered layer IDs resolve to fixed source endpoints. Unknown
layers return `404`; caller query parameters are not forwarded upstream, and
upstream redirects are rejected.

Errors use the existing JSON API error envelope:

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Non-integer coordinates, unsupported zoom, or coordinates outside the matrix |
| 404 | `NOT_FOUND` | Unknown layer or missing upstream tile |
| 502 | `IMAGERY_ERROR` | Upstream HTTP/network failure, wrong content type, empty image, or failed body download |
| 504 | `IMAGERY_TIMEOUT` | The upstream request, including its body, exceeded 15 seconds |

The API finishes downloading each tile before sending image headers so failed
body downloads still return JSON. Only the original image bytes and the layer's
content type are returned; upstream cookies and attachment headers are omitted.
Caller cancellation is forwarded to the upstream request. The browser should
bound concurrent requests and cancel imagery it no longer needs as the view
changes.

## Verified upstream

[Moon Trek's WMTS documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon)
describes requesting image tiles and interpreting capabilities metadata.

The following GET requests returned HTTP 200:

- [Capabilities](https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml),
  7,241 bytes of XML.
- [Sample tile](https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/0/0/0.jpg),
  49,475 bytes of JPEG imagery.

The capabilities declare global bounds, 256-pixel tiles, and levels 0–8. Global
bounds describe the tile grid; local image quality and missing pixels still
need checking, especially in polar/shadowed terrain.

This mosaic contains captured illumination. It is suitable for testing image
placement, but it does not establish physically correct relighting. Before
claiming time-accurate surface shadows, assess a suitable normalized reflectance
layer from the preferred services and its coverage. Geometry, imagery and
lighting remain separate inputs.

## What is needed next

The [fixed surface preview](surface-preview.md) now uses these imagery endpoints,
the existing terrain manifest/binary tiles, and captured Horizons positions for
one Marius Hills observer and time. Connect it to the planning location and
timeline inputs next. No server-generated 3D model is required.

The layer contract is `GeographicImageryLayer` in `packages/contracts/src/imagery.ts`.
The routes are in `apps/api/src/imagery.ts`. Offline API and bundled Worker tests
cover metadata, matrix boundaries, row/column order, original JPEG bytes,
cancellation, timeouts, and upstream failures. The JPEG fixture was captured
from the sample tile above.
