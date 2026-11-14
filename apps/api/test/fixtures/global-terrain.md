# Global calculation references

`global-reference.json` records independent original byte-range reads from the
NASA/MIT LOLA LDEM_64 and LDEM_16 V3.1 images on 2026-11-15. The fixture was
captured before comparing against prepared tiles. Each pixel records its
zero-based row/column, centre coordinates, native signed digital number, and
height in metres. Pole heights are complete nearest-latitude-ring means, with
hashes of those original ring bytes. They describe the cylindrical calculation
model, separate from the old fine-polar references.

`global-{north,south}-{earth,sun}.json` contains real Horizons responses captured
sequentially for longitude 0, latitude +90/-90, eye height 2 m above those ring
means, 2026-11-15 00:00 through 01:00 UTC, at 60-minute steps. Observer altitudes
were -0.010800933159722222 km north and 1.1980204210069443 km south above the
1737.4 km reference sphere. These fixtures let offline runtime tests verify the
same observer height, frame, terrain profile, JSON/CSV and visibility path.

Tests never contact the live sources. Source URLs and hashes are retained in
the reference and prepared manifests. To update references, read original
source bytes independently rather than derive expected values from our tiles.
