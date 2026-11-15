# Submitted Moon surface view

Submit a valid time range and lunar location on the main page. After the
`/api/timeline` request succeeds, a Surface section appears directly below
Planner and the page scrolls to it at `/#surface`. The section fills the
browser viewport. The navigation pill, Submit button and footer hide while
Surface is active. Scrolling up returns to the still-mounted inputs; another
successful submission replaces the scene and scrolls back down. Failed or
cancelled requests leave the previous scene intact.

The Surface section and its navigation link are absent until a location has
been submitted successfully. A small starting snapshot persists for refresh
in the current tab. Without a saved submission, `/#surface` falls back to Home.
There is no separate `/surface` route or fixed demonstration scene. New submissions
save the full set of timeline positions in the current tab. Older saved snapshots
still open, with a disabled timeline until another submission.

The scene uses the response's observer latitude, longitude, ground elevation
and eye height, and initially displays the Earth and Sun at the selected start time.
The bottom timeline briefly appears for three seconds each time scrolling enters
Surface, including when returning to a previously submitted scene, then
fades out. Hover near the bottom, focus the slider with the keyboard, or tap the
bottom on a touch screen to reveal it. It stays visible during a drag. Its only
visible text is "Surface time" and the selected UTC timestamp above the track.
The surface has no site labels, compass, Earth label, camera instructions, height
readout or reload button. The back-to-planner popup remains at the top. The
canvas fills the viewport, with the timeline and its translucent shading drawn
over the surface rather than reserving a bottom panel.
Click to select a time, or drag
to preview a time and release to update the scene. Keyboard changes update the
scene immediately. Cancelled pointer gestures restore the selected time. Earth,
Sun, light direction, apparent disc sizes and terrain shadows update in place;
terrain, imagery and the camera bearing remain loaded. Directions interpolate
between returned samples, with azimuths crossing north by the shortest path.
The track ends at the last returned sample to avoid extrapolating beyond the
available data. A white vertical playhead marks the selected time. The track uses
the API's `isVisible` flags: green when both Earth and Sun are visible, yellow
for Sun only, lavender for Earth only, and gray for neither. Each sample's flags
apply until the next sample, so color boundaries have the API's sampling
resolution. There is no playback yet.
The view initially faces the
horizon. Drag or use arrow keys to look around; Home
points the camera toward Earth's currently selected position. Mouse-wheel scrolling and vertical touch
swipes scroll back to the inputs.

The global LDEM_64 numerical terrain matches the API's near-field calculation,
with bilinear interpolation, longitude wrapping and the same averaged pole
heights. Downloaded tiles are checked against their manifest hashes with native
SHA-256 where available, or a JavaScript SHA-256 fallback on plain HTTP LAN
addresses, where the browser does not expose `crypto.subtle`. Integrity checks
remain enabled in both cases. The mesh has lunar curvature and no vertical
exaggeration. Terrain and photographic
imagery center on the returned observer. Polar imagery uses a lower zoom to
keep its atlas within 64 tiles. Each batch has at most four downloads in
flight, and replacing or reloading the scene cancels outstanding requests and
releases the previous renderer's resources.

WAC layer metadata and JPEGs come through `/api/imagery`. UVs use its geographic
matrix directly, including longitude wrapping. No persistent imagery cache is
added. The API supplies azimuth and elevation but no body distances. Astronomy
Engine estimates Earth and Sun distances at the selected time solely for apparent
disc sizes. Directions always come from the response. Separate sky and terrain
passes preserve celestial depth while terrain still occludes the sky.

Photographic imagery contains captured illumination, so its combination with
the selected Sun direction is not physically accurate relighting. The Earth
texture's clouds and orientation are illustrative. See `public/moon/README.md`
for asset sources. The old Marius Hills snapshot remains as a geometry test
fixture and is not loaded by the scene.
