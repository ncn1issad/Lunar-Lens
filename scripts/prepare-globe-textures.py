#!/usr/bin/env python3
"""Prepare browser assets from NASA's LROC color map and local LOLA tiles.

Requires Pillow. The source TIFF stays outside the repository. Run with:
python3 scripts/prepare-globe-textures.py --color-source /tmp/nasa-lroc-color-2019-8k.tif
"""
import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import sys
from PIL import Image

COLOR_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif'


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def prepare_normals(terrain_root, width):
    manifest = json.loads((terrain_root / 'manifest.json').read_text())
    if (manifest['encoding'], manifest['westDeg'], manifest['eastDeg'], manifest['heightScaleM']) != ('int16-le', 0, 360, 0.5):
        raise ValueError('Expected the prepared 0–360 degree LOLA half-metre tiles')
    size = manifest['tileSize']
    dem = Image.new('I', (manifest['width'], manifest['height']))
    for name, expected_hash in manifest['tiles'].items():
        path = terrain_root / name
        if digest(path) != expected_hash:
            raise ValueError(f'Terrain tile hash mismatch: {name}')
        x, y = map(int, path.stem.split('-'))
        tile = Image.frombytes('I', (size, size), path.read_bytes(), 'raw', 'I;16S')
        dem.paste(tile, (x * size, y * size))
    # The color map starts at -180°, while the prepared terrain starts at 0°.
    half = dem.width // 2
    centered = Image.new('I', dem.size)
    centered.paste(dem.crop((half, 0, dem.width, dem.height)), (0, 0))
    centered.paste(dem.crop((0, 0, half, dem.height)), (half, 0))
    grid = centered.convert('F').resize((width, width // 2), Image.Resampling.BILINEAR)
    heights = array('f')
    heights.frombytes(grid.tobytes())
    if sys.byteorder != 'little':
        raise ValueError('This preparation script expects a little-endian host')
    height = grid.height
    result = bytearray(width * height * 3)
    # Heights are decoded from half-metres; slopes use physical arc distances.
    north_spacing = manifest['referenceRadiusM'] * math.pi / height
    for row in range(height):
        latitude = math.pi / 2 - (row + 0.5) * math.pi / height
        east_spacing = manifest['referenceRadiusM'] * 2 * math.pi / width * max(0.01, math.cos(latitude))
        # Fade the singular longitude derivative in the last half-degree at each pole.
        polar_fade = min(1, (90 - abs(math.degrees(latitude))) / 0.5)
        north = max(0, row - 1) * width
        south = min(height - 1, row + 1) * width
        offset = row * width
        for col in range(width):
            east_slope = (heights[offset + (col + 1) % width] - heights[offset + (col - 1) % width]) * 0.5 / (2 * east_spacing) * polar_fade
            north_slope = (heights[north + col] - heights[south + col]) * 0.5 / (2 * north_spacing)
            length = math.sqrt(east_slope * east_slope + north_slope * north_slope + 1)
            index = (offset + col) * 3
            result[index:index + 3] = bytes(round((component / length * 0.5 + 0.5) * 255)
                                           for component in (-east_slope, -north_slope, 1))
    return Image.frombytes('RGB', grid.size, bytes(result)), manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--color-source', type=Path, required=True)
    parser.add_argument('--terrain-root', type=Path, default=Path('apps/web/public/terrain/ldem_16'))
    parser.add_argument('--output', type=Path, default=Path('apps/web/public/moon'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    source = Image.open(args.color_source)
    if source.size != (8192, 4096):
        raise ValueError('Expected NASA’s 8192 × 4096 LROC map')
    color = source.convert('RGB')
    outputs = []
    for width in (8192, 4096):
        path = args.output / f'color-{width // 1024}k.jpg'
        color.resize((width, width // 2), Image.Resampling.LANCZOS).save(path, quality=92, subsampling=0, optimize=True)
        outputs.append(path)
    for width in (4096, 2048):
        normal, manifest = prepare_normals(args.terrain_root, width)
        path = args.output / f'normal-{width // 1024}k.png'
        normal.save(path, optimize=True)
        outputs.append(path)
    metadata = {
        'color': {'source': COLOR_URL, 'sourceSha256': digest(args.color_source), 'encoding': 'sRGB, 8-bit JPEG, quality 92, 4:4:4'},
        'normal': {'source': manifest['sourceUrl'], 'sourceProduct': manifest['sourceProduct'],
                   'manifestSha256': digest(args.terrain_root / 'manifest.json'),
                   'referenceRadiusM': manifest['referenceRadiusM'], 'heightExaggeration': 1,
                   'encoding': 'linear tangent-space RGB PNG, OpenGL +Y', 'polarLongitudeFadeDeg': 0.5},
        'outputs': {path.name: {'bytes': path.stat().st_size, 'sha256': digest(path)} for path in outputs},
    }
    (args.output / 'globe-textures.json').write_text(json.dumps(metadata, indent=2) + '\n')
    for path in outputs:
        print(f'{path.name}: {path.stat().st_size:,} bytes', flush=True)


if __name__ == '__main__':
    main()
