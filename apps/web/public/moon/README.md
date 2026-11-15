# Moon and Earth textures

`color.jpg` is NASA's 2025 LROC color map preview, 2048 × 1024 pixels.

- Source: https://svs.gsfc.nasa.gov/4720/
- Original: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg
- Credit: NASA's Scientific Visualization Studio; color data from NASA/LRO/LROC.
- Downloaded 2026-11-14, without modification.

Used for the globe's appearance only. The globe is a sphere and does not use
elevation displacement or the visibility API.

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
