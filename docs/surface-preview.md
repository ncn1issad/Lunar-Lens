# Submitted Moon surface view

Submit a valid time range and lunar location on the main page. After the
`/api/timeline` request succeeds, a Surface section appears directly below
Location and the page scrolls to it at `/#surface`. The section fills the
browser viewport. The navigation pill, Submit button and footer hide while
Surface is active. Scrolling up returns to the still-mounted inputs; another
successful submission replaces the scene and scrolls back down. Failed or
cancelled requests leave the previous scene intact.

The Surface section and its navigation link are absent until a location has
been submitted successfully. A small starting snapshot persists for refresh
in the current tab. Without a saved submission, `/#surface` falls back to Home.
There is no separate `/surface` route or fixed demonstration scene.

The scene uses the response's observer latitude, longitude, ground elevation
and eye height, and the Earth and Sun directions at the selected start time.
Later timeline samples are not displayed yet. The view initially faces the
horizon. Drag or use arrow keys to look around; "Look toward Earth" or Home
points the camera toward Earth. Mouse-wheel scrolling and vertical touch
swipes scroll back to the inputs. "Reload view" rebuilds the submitted scene
without repeating the timeline request.

The global LDEM_64 numerical terrain matches the API's near-field calculation,
with bilinear interpolation, longitude wrapping and the same averaged pole
heights. Downloaded tiles are checked against their manifest hashes. The mesh
has lunar curvature and no vertical exaggeration. Terrain and photographic
imagery center on the returned observer. Polar imagery uses a lower zoom to
keep its atlas within 64 tiles. Each batch has at most four downloads in
flight, and replacing or reloading the scene cancels outstanding requests and
releases the previous renderer's resources.

WAC layer metadata and JPEGs come through `/api/imagery`. UVs use its geographic
matrix directly, including longitude wrapping. No persistent imagery cache is
added. The API supplies azimuth and elevation but no body distances. Astronomy
Engine estimates Earth and Sun distances at the start time solely for apparent
disc sizes. Directions always come from the response. Separate sky and terrain
passes preserve celestial depth while terrain still occludes the sky.

Photographic imagery contains captured illumination, so its combination with
the selected Sun direction is not physically accurate relighting. The Earth
texture's clouds and orientation are illustrative. See `public/moon/README.md`
for asset sources. The old Marius Hills snapshot remains as a geometry test
fixture and is not loaded by the scene.
