#!/usr/bin/env python3
"""Prepare global LDEM_64/LDEM_16 calculation tiles in native half-metre int16."""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
from terrain_source import digest, download

BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/'
MIT = 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/'
TILE_SIZE = 256


def validate_label(label, ppd):
    expected = {
        'PRODUCT_VERSION_ID': '"V3.1"', 'FILE_NAME': f'"LDEM_{ppd}.IMG"',
        'LINES': str(180 * ppd), 'LINE_SAMPLES': str(360 * ppd),
        'SAMPLE_TYPE': 'LSB_INTEGER', 'SAMPLE_BITS': '16', 'UNIT': 'METER',
        'SCALING_FACTOR': '0.5', 'OFFSET': '1737400.',
        'MAP_PROJECTION_TYPE': '"SIMPLE CYLINDRICAL"',
        'COORDINATE_SYSTEM_NAME': '"MEAN EARTH/POLAR AXIS OF DE421"',
        'POSITIVE_LONGITUDE_DIRECTION': '"EAST"',
        'A_AXIS_RADIUS': '1737.4 <km>', 'B_AXIS_RADIUS': '1737.4 <km>', 'C_AXIS_RADIUS': '1737.4 <km>',
        'MAP_RESOLUTION': f'{ppd} <pix/deg>', 'MAXIMUM_LATITUDE': '90 <deg>',
        'MINIMUM_LATITUDE': '-90 <deg>', 'WESTERNMOST_LONGITUDE': '0 <deg>',
        'EASTERNMOST_LONGITUDE': '360 <deg>',
        'CENTER_LATITUDE': '0 <deg>', 'CENTER_LONGITUDE': '180 <deg>',
        'LINE_PROJECTION_OFFSET': f'{height_offset(ppd)} <pix>',
        'SAMPLE_PROJECTION_OFFSET': f'{width_offset(ppd)} <pix>',
    }
    for key, value in expected.items():
        match = re.search(r'^\s*' + key + r'\s*=\s*(.*?)\s*$', label, re.M)
        if not match or match[1] != value:
            raise ValueError(f'Unexpected LDEM_{ppd} label {key}; expected {value}')


def height_offset(ppd):
    return f'{90 * ppd - 0.5:g}'


def width_offset(ppd):
    return f'{180 * ppd - 0.5:g}'


def prepare(ppd, output_root, source_dir, mirror='mit'):
    product = f'ldem_{ppd}'
    width, height = 360 * ppd, 180 * ppd
    label_path, image_path = source_dir / f'{product}.lbl', source_dir / f'{product}.img'
    download(BASE + label_path.name, label_path)
    label_bytes = label_path.read_bytes()
    validate_label(label_bytes.decode('ascii'), ppd)
    image_url = BASE + image_path.name
    if mirror == 'mit':
        mirror_label = source_dir / f'{product}-mit.lbl'
        download(MIT + label_path.name.upper(), mirror_label)
        if mirror_label.read_bytes() != label_bytes:
            raise ValueError('MIT and PDS product labels differ; refuse to mix download sources')
        image_url = MIT + image_path.name.upper()
    download(image_url, image_path, width * height * 2)
    output = output_root / product
    output.mkdir(parents=True, exist_ok=True)
    tiles, bands = {}, []
    source_hash = hashlib.sha256()
    missing = 0
    with image_path.open('rb') as source:
        for tile_row in range(math.ceil(height / TILE_SIZE)):
            rows = min(TILE_SIZE, height - tile_row * TILE_SIZE)
            band = source.read(rows * width * 2)
            source_hash.update(band)
            bands.append(digest(band))
            values = array.array('h')
            values.frombytes(band)
            if sys.byteorder != 'little':
                values.byteswap()
            missing += values.count(-32768)
            for tile_col in range(math.ceil(width / TILE_SIZE)):
                columns = min(TILE_SIZE, width - tile_col * TILE_SIZE)
                tile = bytearray(b'\x00\x80' * TILE_SIZE**2)
                for row in range(rows):
                    start = (row * width + tile_col * TILE_SIZE) * 2
                    offset = row * TILE_SIZE * 2
                    tile[offset:offset + columns * 2] = band[start:start + columns * 2]
                name = f'{tile_col}-{tile_row}.bin'
                (output / name).write_bytes(tile)
                tiles[name] = digest(tile)
            print(f'{product}: prepared row {tile_row + 1}/{math.ceil(height / TILE_SIZE)}', flush=True)
    if missing:
        raise ValueError(f'{product}: source contains {missing} missing heights')
    manifest = {
        'format': 'lunar-dem-i16-v1', 'id': f'lola-global-{ppd}',
        'source': 'NASA/GSFC LRO LOLA', 'sourceProduct': product.upper(),
        'sourceVersion': 'V3.1', 'sourceUrl': image_url,
        'referenceFrame': 'MOON_ME_DE421', 'referenceRadiusM': 1737400,
        'projection': 'simple-cylindrical', 'registration': 'pixel-center',
        'heightUnit': 'meter', 'encoding': 'int16-le', 'heightScaleM': 0.5, 'noData': -32768,
        'pixelsPerDegree': ppd, 'width': width, 'height': height, 'tileSize': TILE_SIZE,
        'northDeg': 90, 'southDeg': -90, 'westDeg': 0, 'eastDeg': 360,
        'tiles': tiles,
        'preparation': {'sourceLabelSha256': digest(label_bytes),
                        'sourceImageSha256': source_hash.hexdigest(),
                        'sourceRangesSha256': bands, 'sourceNoDataCount': missing},
    }
    (output / 'source.lbl').write_bytes(label_bytes)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{product}: {len(tiles)} tiles, {len(tiles) * TILE_SIZE**2 * 2} bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'apps/web/public/terrain')
    parser.add_argument('--source-dir', type=Path, help='Keep/reuse source files and resumable downloads here')
    parser.add_argument('--level', type=int, choices=[16, 64], help='Prepare only one level')
    parser.add_argument('--mirror', choices=['mit', 'pds'], default='mit', help='NASA LOLA archive to download from (default: MIT)')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='lunar-global-source-') as temporary:
        source_dir = args.source_dir or Path(temporary)
        source_dir.mkdir(parents=True, exist_ok=True)
        for ppd in ([args.level] if args.level else [64, 16]):
            prepare(ppd, args.output, source_dir, args.mirror)
