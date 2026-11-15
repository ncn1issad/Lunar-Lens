# Moon and Earth textures

`color.jpg` is NASA's 2025 LROC color map preview, 2048 × 1024 pixels.

- Source: https://svs.gsfc.nasa.gov/4720/
- Original: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg
- Credit: NASA's Scientific Visualization Studio; color data from NASA/LRO/LROC.
- Downloaded 2026-11-14, without modification.

Used for the globe's appearance only. The globe is a sphere and does not use
elevation displacement or the visibility API.

The Planner globe upgrades to `color-8k.jpg` (8192 × 4096) and
`normal-4k.png` (4096 × 2048). Smaller screens, devices reporting 4 GB or less
memory, or GPUs limited to 4K use `color-4k.jpg` and `normal-2k.png` instead.
GPUs limited below 4K retain `color.jpg`. Higher-detail files preload as soon
as the site loads, including image decoding, GPU upload and shader preparation.
The low-resolution globe remains visible on Home and until the detailed
resources are ready in Planner.
Returning to Home restores the preview, and the detailed textures are
reused during the same page session.

The detailed color maps are JPEG conversions of NASA's 2019 8K LROC map:
https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif
They retain the source's sRGB values, with JPEG quality 92 and 4:4:4 chroma.
Like the 2025 preview, this map is based on normalized LROC WAC imagery, with
lower-resolution polar fills. It is intended for rendering, not measurements.

The normal maps come from the project's prepared NASA LOLA `LDEM_16` tiles.
The script verifies each tile hash, shifts 0–360° terrain to match the color
map's -180–180° registration, and computes slopes in metres on the
1,737,400 m sphere. No height exaggeration is applied. The longitude slope
fades over the last half-degree at each pole to avoid the coordinate
singularity. Normal maps are linear tangent-space RGB (+Y) PNGs.
This adds relief to lighting; the model and click intersections remain
spherical, with no terrain self-shadow calculation.

Rebuild with Pillow and the existing prepared `ldem_16` dataset:

```sh
curl -fL 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif' -o /tmp/nasa-lroc-color-2019-8k.tif
python3 scripts/prepare-globe-textures.py --color-source /tmp/nasa-lroc-color-2019-8k.tif
```

`globe-textures.json` records source hashes, processing settings, output sizes,
and output hashes. Credit NASA's Scientific Visualization Studio, LRO/LROC,
and NASA/GSFC LRO LOLA.

`earth.jpg` is the 2048 by 1024 Earth atmosphere texture from the
[Three.js examples](https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg),
downloaded without modification on 2026-11-15. The surface preview uses it for
Earth's appearance. Cloud patterns and the globe's axial/texture orientation
are illustrative; its position, angular size and lighting direction use the
fixed Horizons snapshot.

`surface-preview.json` captures NASA/JPL Horizons at 2026-12-03 12:00:00 UTC
for Marius Hills, 303 degrees east and 14 degrees north. Observer altitude is
-1.5658416748046875 km above the lunar reference sphere, from SLDEM2015 ground
height plus a 2 m eye height. Earth and Sun were requested sequentially with
`CENTER=coord@301`, `COORD_TYPE=GEODETIC`, `SITE_COORD=303,14,-1.5658416748046875`,
`EPHEM_TYPE=OBSERVER`, `QUANTITIES=4,20`, `APPARENT=AIRLESS`, `TIME_TYPE=UT`,
`CAL_TYPE=GREGORIAN`, `START_TIME=2026-12-03 12:00:00`,
`STOP_TIME=2026-12-03 12:01:00` and `STEP_SIZE=1 min` through the
[Horizons API](https://ssd.jpl.nasa.gov/api/horizons.api).
The first sample is retained; distances are converted from AU using
149597870.7 km per AU. The preview never queries Horizons while looking around.
