# Resources and data access

This guide records the data used by Lunar Lens, where it comes from, and whether the running app contacts the source. API contracts are in the [API reference](api.md).

## Live services

The browser requests data and assets from the app's own origin. The API contacts two external services during normal use:

| Service | What the app requests | When |
| --- | --- | --- |
| [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Sun and Earth azimuth/elevation for the selected lunar coordinates, observer altitude, and time range | Each new timeline submission, or a legacy single-date API request |
| [NASA Moon Trek](https://trek.nasa.gov/moon/) | LROC WAC global mosaic JPEG tiles for the surface view | When loading surface imagery |

### JPL Horizons

The API sends requests to `https://ssd.jpl.nasa.gov/api/horizons.api` with Moon observer center `coord@301`, target `399` for Earth and `10` for the Sun. It requests observer ephemerides, quantity `4` for azimuth/elevation, and `APPARENT=AIRLESS`. Terrain-derived observer altitude is used for timelines; the legacy endpoint uses 0 km above the reference sphere.

The timeline parser verifies the returned lunar observer frame, reference radii, timestamps, and alignment between Earth and Sun samples. Body directions are reused in the browser during timeline playback. There is no Horizons request for each animation frame.

References are the [Horizons API specification](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [observer coordinates](https://ssd.jpl.nasa.gov/horizons/manual.html#observer), [reference frames](https://ssd.jpl.nasa.gov/horizons/manual.html#reference-frames), and [API usage policy](https://ssd-api.jpl.nasa.gov/doc/index.php). See the API's [runtime behavior](api.md#runtime-behavior) for request serialization and timeouts.

### Moon Trek imagery

The surface view uses `LRO_WAC_Mosaic_Global_303ppd_v02`, served by Moon Trek. The API proxies original JPEG bytes from this fixed template:

```text
https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg
```

The layer uses an equirectangular geographic matrix with 256-pixel tiles, zoom levels 0 through 8, and global bounds. It is not Web Mercator. Tile imagery is independent of the selected date. Surface loading uses at most four concurrent requests per download batch and reduces imagery zoom near the poles to bound atlas size.

Source definitions are in the [WMTS capabilities](https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/WMTSCapabilities.xml) and [Moon Trek tile documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon).

Credit: NASA / LRO / LROC; served by Moon Trek.

## Packaged terrain

Numerical terrain is downloaded and prepared offline. At runtime, the API reads tiles through Workers Static Assets, and the surface view reads local LDEM_64 tiles from the same origin. Neither requests individual terrain heights from NASA.

| Dataset | Use | Packaged location |
| --- | --- | --- |
| NASA LOLA LDEM_64 V3.1 | Ground elevation, skyline within 60 km, and surface mesh | `apps/web/public/terrain/ldem_64/` |
| NASA LOLA LDEM_16 V3.1 | Skyline beyond 60 km to the requested radius; source for globe normal maps | `apps/web/public/terrain/ldem_16/` |
| SLDEM2015 V2.0, Marius Hills crop | Retained regional data and geometry tests | `apps/web/public/terrain/` |
| LOLA LDEM_80N_80M V2.1 and LDEM_80S_80M V2.0 | Retained fine polar data and loader tests | `apps/web/public/terrain/north/` and `south/` |

The running skyline calculation and surface view use the global data, not the retained regional or fine polar datasets.

### Global LOLA data

LDEM_64 and LDEM_16 use the `MOON_ME_DE421` frame, a 1,737,400 m reference sphere, east-positive longitude, and pixel-center registration. Native heights are signed little-endian 16-bit integers with `heightM = value * 0.5`. Values are heights above the sphere, not radii.

| Product | Dimensions | North/south grid spacing | Prepared storage |
| --- | --- | --- | --- |
| LDEM_64 | 23040 by 11520 | About 473.8 m | 4,050 tiles, 506.25 MiB |
| LDEM_16 | 5760 by 2880 | About 1.895 km | 276 tiles, 34.5 MiB including padding |

Tiles are 256 by 256 samples. Manifests retain the source product/version, image and label hashes, source-row hashes, and tile hashes. The preparation script validates the PDS labels and preserves native samples without resampling or float conversion. Runtime loaders verify tile hashes. Edge padding uses the reserved no-data value and is excluded from valid sampling.

Source archives and definitions:

- [NASA PDS LOLA global grids](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/)
- [NASA PDS grid specification](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/document/archsis.htm)
- [MIT LOLA archive](https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/), the default image mirror

To regenerate from the repository root with Python 3:

```sh
python3 scripts/prepare-global-terrain.py --source-dir /tmp/lunar-lense-global-source
pnpm build
```

The script uses the Python standard library and resumable downloads. Retain the source directory to resume interrupted transfers. `--mirror pds` selects the PDS image source; `--level 64` or `--level 16` prepares one layer. Global source downloads total about 538 MiB.

Credit: NASA/GSFC, Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter.

### Retained regional and polar data

The Marius Hills SLDEM2015 crop covers 12 to 16 degrees north and 301 to 305 degrees east at 512 pixels per degree, about 59 m north/south spacing. Its sixteen 512 by 512 float32 metre tiles occupy 16 MiB. The fine polar datasets use 80 m stereographic grids for the 80-to-90-degree caps. Each cap has 225 prepared tiles; together they occupy 225 MiB.

Preparation scripts are [prepare-terrain.py](../scripts/prepare-terrain.py) and [prepare-polar-terrain.py](../scripts/prepare-polar-terrain.py). Their source labels and hashes remain with the assets. References are the [SLDEM2015 product description](https://pgda.gsfc.nasa.gov/products/54), [PDS SLDEM2015 archive](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/), [PDS polar archive](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/), and [polar projection definitions](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/dsmap_polar.cat).

## Packaged textures

Textures live in `apps/web/public/moon/` and load from the app's origin. These source websites are not contacted by the running renderer.

| Asset | Source and processing | Use |
| --- | --- | --- |
| `color.jpg` | [NASA SVS 2025 LROC 2K preview](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg), downloaded unchanged on 2026-11-14 | Home globe |
| `color-8k.jpg`, `color-4k.jpg` | JPEG conversions of the [NASA SVS 2019 LROC 8K map](https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif), sRGB, quality 92, 4:4:4 chroma | Detailed planner globe |
| `normal-4k.png`, `normal-2k.png` | Derived from packaged LDEM_16 with no height exaggeration; linear tangent-space RGB, OpenGL +Y | Globe relief shading |
| `earth.jpg` | [Three.js Earth atmosphere texture](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg), downloaded unchanged on 2026-11-15 | Earth's appearance in the surface view |

The globe remains spherical for both rendering geometry and click selection. Normal maps change its shading, not its shape. The detailed textures preload and are reused within the page session; smaller devices use lower-resolution variants.

Normal-map generation shifts terrain longitude registration to match the color map and calculates slopes on the 1,737,400 m sphere. The longitude slope fades within half a degree of each pole. Source hashes, processing settings, output sizes, and output hashes are recorded in [globe-textures.json](../apps/web/public/moon/globe-textures.json).

To regenerate the detailed textures, install Pillow in your Python environment and run from the repository root:

```sh
curl -fL 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif' -o /tmp/nasa-lroc-color-2019-8k.tif
python3 scripts/prepare-globe-textures.py --color-source /tmp/nasa-lroc-color-2019-8k.tif
```

The normal-map step also needs the prepared LDEM_16 dataset.

Credits: [NASA's Scientific Visualization Studio CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), NASA/LRO/LROC, NASA/GSFC LRO LOLA, and the Three.js examples for the Earth texture.

## Coordinates and local astronomy

Apollo preset coordinates come from [NASA NSSDCA's LRO-based landing-site table](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html). They are stored in [planning-location.ts](../apps/web/src/planning-location.ts), alongside the Marius Hills and pole presets. The table is a reference, not a live data request.

[Astronomy Engine](https://github.com/cosinekitty/astronomy) runs locally in the browser. It calculates the home globe's current sunlight and lunar orientation and estimates Sun/Earth distances for apparent disc sizes in the surface view. It does not replace Horizons directions in submitted results. The home view uses the browser clock and does not request device location.

[LROC QuickMap](https://quickmap.lroc.asu.edu/) is a challenge resource and research reference. The running app does not request QuickMap data or terrain meshes.

## Calculation and display limits

- Visibility compares each body's center with the terrain skyline. It does not calculate partial disc visibility, solar-array output, battery use, or radio-link performance.
- The planner requests hourly samples. Animated directions interpolate between those samples, while visibility colors hold each sample's flags until the next sample. A slider timestamp in seconds does not imply second-level visibility accuracy.
- Grid resolution limits which ridges and peaks the model can represent. Extra rays cannot recover terrain detail absent from the source data. Far-field cell envelopes can overestimate an obstruction's angular extent.
- The default and maximum terrain search radius is 480 km. The calculation does not prove that more distant terrain can never matter. Ground height at each exact pole is approximated using the nearest latitude-ring mean.
- The rendered mesh covers a local area and does not reproduce the full API skyline search. Its photographic texture contains captured lighting. Surface shadows and the Earth texture's orientation/clouds are illustrative; eclipse shadows are not modeled.

## Test data and reproducibility

The API tests use captured Horizons responses and image bytes, plus independent source samples and synthetic terrain cases. They run without live NASA requests. Provenance is retained in the [global terrain fixture notes](../apps/api/test/fixtures/global-terrain.md), [imagery fixture notes](../apps/api/test/fixtures/imagery.md), JSON fixtures, and asset manifests.

`apps/web/public/moon/surface-preview.json` is a retained Marius Hills reference snapshot for 2026-12-03 at 12:00 UTC. It uses longitude 303 degrees east, latitude 14 degrees north, SLDEM2015 ground height plus a 2 m eye height, and observer altitude -1.5658416748046875 km. Its sequential Horizons requests used `QUANTITIES=4,20` for directions and distances. The live surface view uses submitted timeline data instead of this fixed snapshot.

## Software resources

The app uses React, TypeScript, Vite, Three.js, GSAP, Astronomy Engine, Hono, and Cloudflare Workers. Supporting packages include csv-parse and @noble/hashes. Exact dependency versions are recorded in the workspace package manifests and `pnpm-lock.yaml`.

OpenAI Codex assisted with repository review and this documentation cleanup. A project submission should also disclose any other AI use by the team.
