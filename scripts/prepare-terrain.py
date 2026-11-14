#!/usr/bin/env python3
"""Prepare a native-resolution SLDEM2015 Marius Hills demo, using only Python stdlib.

Fetch strips of 128 rows with HTTP multipart byte ranges. Input heights are
km; output tiles are little-endian float32 metres at pixel centres. No resampling.
"""
import argparse
import array
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import urllib.request

BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/tiles/float_img/'
PRODUCT = 'sldem2015_512_00n_30n_270_315_float'
PPD = 512
WIDTH = 45 * PPD
HEIGHT = 30 * PPD
ROW_BYTES = WIDTH * 4
NORTH, SOUTH, WEST, EAST = 16, 12, 301, 305


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_label(label):
    expected = {
        'PRODUCT_ID': '"SLDEM2015_512_00N_30N_270_315_FLOAT"',
        'PRODUCT_VERSION_ID': '"V2.0"',
        'LINES': str(HEIGHT), 'LINE_SAMPLES': str(WIDTH),
        'SAMPLE_TYPE': 'PC_REAL', 'SAMPLE_BITS': '32', 'UNIT': 'KILOMETER',
        'SCALING_FACTOR': '1', 'OFFSET': '1737.4',
        'MAP_RESOLUTION': '512 <pix/deg>',
        'MAP_PROJECTION_TYPE': '"SIMPLE CYLINDRICAL"',
        'COORDINATE_SYSTEM_NAME': '"MEAN EARTH/POLAR AXIS OF DE421"',
        'MAXIMUM_LATITUDE': '30 <deg>', 'MINIMUM_LATITUDE': '0 <deg>',
        'WESTERNMOST_LONGITUDE': '270 <deg>', 'EASTERNMOST_LONGITUDE': '315 <deg>',
    }
    for key, value in expected.items():
        match = re.search(r'^\s*' + key + r'\s*=\s*(.*?)\s*$', label, re.M)
        if not match or match[1] != value:
            raise ValueError(f'Unexpected source label {key}; expected {value}')


def fetch_strip(first_row, rows):
    """Fetch only the four-degree crop, instead of entire 45-degree source rows."""
    first_col = (WEST - 270) * PPD
    row_size = (EAST - WEST) * PPD * 4
    spans = [(row * ROW_BYTES + first_col * 4, row * ROW_BYTES + first_col * 4 + row_size - 1)
             for row in range(first_row, first_row + rows)]
    request = urllib.request.Request(BASE + PRODUCT + '.img', headers={
        'Range': 'bytes=' + ','.join(f'{start}-{end}' for start, end in spans),
    })
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 206:
            raise ValueError('Server did not honor byte ranges')
        content_type = response.headers.get('Content-Type', '')
        if not content_type.startswith('multipart/byteranges;'):
            raise ValueError('Expected multipart byte ranges')
        # Bound reads even if the server returns an unexpected body.
        data = response.read(rows * (row_size + 1024) + 4096)
    # This server uses an unquoted boundary containing angle brackets. MIME
    # parsers normalize those brackets away, so preserve the exact wire value.
    boundary_match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type)
    if not boundary_match:
        raise ValueError('Missing multipart boundary')
    boundary = (boundary_match[1] or boundary_match[2]).strip().encode('ascii')
    marker = b'--' + boundary
    segments = data.split(marker)
    if segments[0] or segments[-1].strip() != b'--':
        raise ValueError('Truncated multipart response')
    parts = segments[1:-1]
    if len(parts) != rows:
        raise ValueError('Unexpected multipart range count')
    result = bytearray()
    for part, (start, end) in zip(parts, spans):
        if not part.startswith(b'\r\n') or not part.endswith(b'\r\n'):
            raise ValueError('Malformed multipart delimiter')
        headers, payload = part[2:-2].split(b'\r\n\r\n', 1)
        expected = f'Content-Range: bytes {start}-{end}/{WIDTH * HEIGHT * 4}'.encode('ascii')
        if expected not in headers.split(b'\r\n'):
            raise ValueError('Server returned an unexpected byte range')
        if len(payload) != row_size:
            raise ValueError('Truncated or oversized source range')
        result.extend(payload)
    return result


def prepare(output, source_dir=None):
    output.mkdir(parents=True, exist_ok=True)
    if source_dir:
        label_bytes = (source_dir / (PRODUCT + '.lbl')).read_bytes()
    else:
        with urllib.request.urlopen(BASE + PRODUCT + '.lbl', timeout=60) as response:
            label_bytes = response.read()
    validate_label(label_bytes.decode('ascii'))
    (output / 'source.lbl').write_bytes(label_bytes)
    tiles, ranges = {}, []
    for tile_row in range(NORTH - SOUTH):
        first_row = (30 - NORTH + tile_row) * PPD
        crop_row_bytes = (EAST - WEST) * PPD * 4
        block = bytearray()
        if source_dir:
            with (source_dir / (PRODUCT + '.img')).open('rb') as source:
                if source.seek(0, 2) != WIDTH * HEIGHT * 4:
                    raise ValueError('Unexpected source IMG size')
                for row in range(first_row, first_row + PPD):
                    source.seek(row * ROW_BYTES + (WEST - 270) * PPD * 4)
                    block.extend(source.read(crop_row_bytes))
        else:
            for row in range(first_row, first_row + PPD, 128):
                block.extend(fetch_strip(row, 128))
                print(f'Downloaded {row - (30 - NORTH) * PPD + 128}/{(NORTH - SOUTH) * PPD} source rows', flush=True)
        if len(block) != PPD * crop_row_bytes:
            raise ValueError('Truncated or oversized source range')
        ranges.append(digest(block))
        for tile_col in range(EAST - WEST):
            values = array.array('f')
            first_col = tile_col * PPD
            for row in range(PPD):
                offset = row * crop_row_bytes + first_col * 4
                values.frombytes(block[offset:offset + PPD * 4])
            if sys.byteorder != 'little':
                values.byteswap()
            for i, value in enumerate(values):
                # The label has no missing-value code. Reject implausible values
                # rather than silently treating a sentinel as real terrain.
                if not math.isfinite(value) or not -20 <= value <= 20:
                    raise ValueError('Missing or implausible source elevation')
                values[i] = value * 1000
            if sys.byteorder != 'little':
                values.byteswap()
            data = values.tobytes()
            name = f'{tile_col}-{tile_row}.bin'
            (output / name).write_bytes(data)
            tiles[name] = digest(data)
        print(f'Prepared row {tile_row + 1}/{NORTH - SOUTH}', flush=True)
    manifest = {
        'format': 'lunar-dem-f32-v1', 'id': 'sldem2015-v2-marius-hills-512ppd',
        'source': 'NASA/GSFC LOLA + JAXA SELENE TC SLDEM2015',
        'sourceUrl': BASE + PRODUCT + '.img',
        'sourceProduct': PRODUCT.upper(), 'sourceVersion': 'V2.0',
        'referenceFrame': 'MOON_ME_DE421', 'referenceRadiusM': 1737400,
        'projection': 'simple-cylindrical', 'registration': 'pixel-center',
        'heightUnit': 'meter', 'encoding': 'float32-le', 'noData': 'NaN',
        'pixelsPerDegree': PPD, 'tileSize': PPD,
        'northDeg': NORTH, 'southDeg': SOUTH, 'westDeg': WEST, 'eastDeg': EAST,
        'tiles': tiles,
        'preparation': {'sourceLabelSha256': digest(label_bytes), 'sourceRangesSha256': ranges},
    }
    # Publish the manifest last so partial preparations cannot advertise success.
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'apps/web/public/terrain')
    parser.add_argument('--source-dir', type=Path, help='Use already downloaded .lbl and .img files')
    args = parser.parse_args()
    prepare(args.output, args.source_dir)
