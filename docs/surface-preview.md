# Fixed Moon surface preview

Open `/#surface`, or scroll past the time picker and select "Surface" in the
page navigation. This is an independent visual experiment. The planning time
picker does not change it.

- Site: Marius Hills, 14 degrees north and 57 degrees west (303 east).
- Time: 2026-12-03 12:00:00 UTC.
- Eye height: 2 m above the prepared SLDEM2015 terrain.
- Drag the canvas or focus it and use arrow keys to look around. "Look toward
  Earth" or the Home key restores the initial direction. The observer cannot
  move, and the time remains fixed.

The scene initializes when the section approaches the visible viewport. It
loads the existing regional float32 height tiles, checks their manifest hashes,
and builds a mesh in local east/up/south coordinates. The mesh includes lunar
curvature and has no vertical exaggeration. Its grid is denser near the observer;
this does not add detail beyond the source DEM's roughly 60 m spacing.

The WAC layer metadata and zoom-8 JPEGs come through `/api/imagery`. The atlas
contains a 4 by 4 group of tiles around the observer. UVs use the geographic
matrix directly, including the conversion between terrain's 0-360 longitudes
and imagery's -180 to 180 convention. Each terrain/imagery batch has at most
four requests in flight, and leaving the page or reloading the view cancels
outstanding requests. No persistent cache is added.

Earth and the Sun use the captured Horizons directions and distances in
`public/moon/surface-preview.json`. Their apparent sizes are not enlarged.
The captured observer altitude is checked against the loaded terrain. A separate
sky pass avoids depth precision problems for celestial objects, while terrain
still occludes them. The black sky uses daytime exposure, with no star field.

WAC photographs already contain illumination. Directional light and terrain
shadow mapping make the relief readable, but this combination does not establish
physically correct shadows for the selected date. The Earth texture's clouds
and orientation are illustrative. See `public/moon/README.md` for asset sources
and the captured Horizons query.

The implementation is in `SurfacePreview.tsx`, `surface-geometry.ts`, and
`surface-preview.css`. Frontend tests check coordinate orientation, curvature,
height interpolation across tile boundaries, atlas alignment, mesh winding,
the frozen observer snapshot, request concurrency, and navigation below the
time picker.
