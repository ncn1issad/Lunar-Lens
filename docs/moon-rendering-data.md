# Moon rendering data

Research checked on 2026-11-14. The first renderer now uses a sphere with the
locally packaged 2K color map, drag rotation, and zoom on a Catppuccin Mocha
space background. A soft presentation fill keeps the unlit surface visible.
The home page derives current sunlight and lunar orientation from the browser
clock with Astronomy Engine, in an Earth-centred, lunar-north-up view.
The elevation and streaming data below remain candidates for future work.

For the planning surface view, the current preference is on-demand imagery
from Moon Trek or QuickMap through the API, alongside the project's existing
elevation dataset and JPL Horizons. See the
[surface imagery API](surface-imagery-api.md) for the implemented Moon Trek
metadata/tile endpoints and their frontend contract.

## Proposed first implementation

Use a textured globe with global elevation for the orbital view, then load the
existing SLDEM2015 tiles for a close view of Marius Hills. Keep the numerical
visibility calculation on the existing terrain service. A globe may display
places outside the region supported by `/api/timeline`; location selection must
make that coverage limit clear.

Package the visual assets with Workers Static Assets, as we already do for
terrain. Prepare browser texture formats offline. This avoids depending on
NASA's cross-origin response headers during rendering and allows us to control
download sizes.

## Existing project data

`/api/moon` returns a skyline sampled around one observer. That angular profile
does not contain the surrounding surface needed to build a terrain mesh.

The mesh can instead read `/terrain/manifest.json` and `/terrain/{column}-{row}.bin`.
These are already public static assets:

- Marius Hills, 12 to 16 degrees north and 301 to 305 degrees east.
- Sixteen tiles, each 512 by 512 float32 little-endian heights in metres.
- 512 pixels per degree, approximately 59 m north/south grid spacing.
- Heights above the 1,737,400 m reference sphere in `MOON_ME_DE421`.
- Pixel-centred registration, rows southward and columns eastward.

Use the manifest for placement and units. A renderer can reduce mesh density for
display without changing the tiles used by the visibility API. See
[terrain.md](terrain.md) for interpolation and calculation limits.

## Global maps

NASA's [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/) supplies global color and
displacement maps centred on 0 degrees longitude.

| Candidate | Dimensions | Published size | Direct download |
| --- | --- | --- | --- |
| 2025 color preview | 2048 × 1024 | 447.2 KB | [JPEG](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg) |
| 2019 color | 4096 × 2048 | 12.5 MB | [TIFF](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif) |
| Unsigned elevation | 1440 × 720 | 2.0 MB | [TIFF](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif) |
| Unsigned elevation | 5760 × 2880 | 31.7 MB | [TIFF](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif) |

For these unsigned height maps, decode `heightM = value * 0.5 - 10000`, then add
the 1,737,400 m sphere radius. Preserve numerical precision through conversion.
Color is sRGB; height values are numerical data. The color maps include polar
fills and aesthetic edits, so use the existing DEM for calculations.

NASA also has [ready-made GLB models](https://svs.gsfc.nasa.gov/14959/): the small
color-only model is 13.2 MB; the small topographic model is 77.7 MB and has
documented polar artifacts. Separate maps are my preferred starting point.

## QuickMap streaming terrain

The current [QuickMap](https://quickmap.lroc.im-ldi.com/) application bundle
references these live metadata endpoints:

- [Regular lunar terrain](https://dem-tiles.b-cdn.net/lunar/qts_demstack/lunar-fulleqc/layer.json)
- [Polar-shifted terrain](https://dem-tiles.b-cdn.net/lunar/qts_demstack/lunar-polarshifted-eqc/layer.json)

Both returned HTTP 200 with `Access-Control-Allow-Origin: *`. Their metadata
declares `quantized-mesh-1.0`, levels 0 through 15, `slippyMap`, and
`octvertexnormals`. The regular mesh template is:

```text
https://dem-tiles.b-cdn.net/lunar/qts_demstack/lunar-fulleqc/mesh/{z}/{x}/{y}.terrain?
```

A GET of tile `0/0/0` returned HTTP 200, the quantized-mesh content type, and
1,148,153 bytes. This verifies a real geometry response, not just metadata.
It does not verify every level or integration with our frontend.

[CesiumTerrainProvider](https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html)
supports this mesh format and an explicit ellipsoid. QuickMap's bundle uses a
terrain provider with its own ellipsoid. A lunar integration must configure the
Moon's radius and check tile orientation and coordinates.

Treat these as observed application endpoints. Their metadata does not identify
the complete source stack, coordinate frame, accuracy, or third-party service
terms. Those remain unresolved before depending on the service. The
polar-shifted endpoint also needs QuickMap's associated coordinate handling.
Keep the current SLDEM service as the source for visibility calculations.

## Checks before building the interface

1. Prepare compact color and numerical height assets with source credits.
2. Check texture orientation against known craters and the Marius Hills marker.
3. Check displacement units and the transition to the local SLDEM mesh.
4. Measure initial download size and frame rate before adding larger maps.

HEAD requests to the linked 2K JPEG, 4K color TIFF, 4 ppd height TIFF, and both
small GLB variants returned HTTP 200. Their observed CORS header allowed a
different origin, not localhost; same-origin packaged assets avoid that issue.
No renderer, dependency, or development server was added during this research.
