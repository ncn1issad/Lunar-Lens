#!/usr/bin/env python3
"""Prepare north/south LOLA 80 m polar tiles, preserving native half-metre int16 heights."""
import argparse
import array
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import urllib.request

BASE = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/'
WIDTH = HEIGHT = 7600
TILE_SIZE = 512
SOURCE_BYTES = WIDTH * HEIGHT * 2
NODATA = -32768


def digest(data):
    return hashlib.sha256(data).hexdigest()


def validate_label(label, pole):
    expected = {
        'PRODUCT_VERSION_ID': '"V2.1"' if pole == 'north' else '"V2.0"',
        'FILE_NAME': f'"LDEM_80{"N" if pole == "north" else "S"}_80M.IMG"',
        'LINES': '7600', 'LINE_SAMPLES': '7600', 'RECORD_BYTES': '15200',
        'SAMPLE_TYPE': 'LSB_INTEGER', 'SAMPLE_BITS': '16', 'UNIT': 'METER',
        'SCALING_FACTOR': '0.5', 'OFFSET': '1737400.',
        'MAP_PROJECTION_TYPE': '"POLAR STEREOGRAPHIC"',
        'KEYWORD_LATITUDE_TYPE': '"PLANETOCENTRIC"',
        'COORDINATE_SYSTEM_NAME': '"MEAN EARTH/POLAR AXIS OF DE421"',
        'POSITIVE_LONGITUDE_DIRECTION': '"EAST"',
        'A_AXIS_RADIUS': '1737.4 <km>', 'B_AXIS_RADIUS': '1737.4 <km>', 'C_AXIS_RADIUS': '1737.4 <km>',
        'CENTER_LATITUDE': '90 <deg>' if pole == 'north' else '-90 <deg>',
        'CENTER_LONGITUDE': '0 <deg>', 'MAP_SCALE': '80 <m/pix>',
        'MAXIMUM_LATITUDE': '90 <deg>' if pole == 'north' else '-80 <deg>',
        'MINIMUM_LATITUDE': '80 <deg>' if pole == 'north' else '-90 <deg>',
        'MAP_PROJECTION_ROTATION': '0.0',
        'LINE_PROJECTION_OFFSET': '3799.5 <pix>', 'SAMPLE_PROJECTION_OFFSET': '3799.5 <pix>',
    }
    for key, value in expected.items():
        match = re.search(r'^\s*' + key + r'\s*=\s*(.*?)\s*$', label, re.M)
        if not match or match[1] != value:
            raise ValueError(f'Unexpected {pole} source label {key}; expected {value}')


def download(url, path, expected_size=None):
    if path.exists() and (expected_size is None or path.stat().st_size == expected_size):
        return
    temporary = path.with_suffix(path.suffix + '.part')
    if expected_size is not None:
        # Small resumable range requests avoid restarting a 116 MB transfer.
        # Four connections are used only during offline preparation, never by the API.
        chunk_size = 4 * 1024 * 1024
        parts = path.with_suffix(path.suffix + '.parts')
        parts.mkdir(exist_ok=True)
        if temporary.exists():
            with temporary.open('rb') as prefix:
                for index in range(temporary.stat().st_size // chunk_size):
                    part = parts / str(index)
                    data = prefix.read(chunk_size)
                    if not part.exists():
                        part.write_bytes(data)

        def chunk(index):
            start = index * chunk_size
            end = min(expected_size, start + chunk_size) - 1
            part = parts / str(index)
            if part.exists() and part.stat().st_size == end - start + 1:
                return
            for attempt in range(3):
                try:
                    request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
                    with urllib.request.urlopen(request, timeout=60) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{expected_size}':
                            raise ValueError('Server returned an unexpected source range')
                        data = response.read(end - start + 2)
                        if len(data) != end - start + 1:
                            raise ValueError('Truncated or oversized source range')
                    part.write_bytes(data)
                    print(f'{path.name}: downloaded source chunk {index + 1}/{math.ceil(expected_size / chunk_size)}', flush=True)
                    return
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(attempt + 1)

        count = math.ceil(expected_size / chunk_size)
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(chunk, range(count)))
        with temporary.open('wb') as output:
            for index in range(count):
                with (parts / str(index)).open('rb') as part:
                    shutil.copyfileobj(part, output)
        if temporary.stat().st_size != expected_size:
            raise ValueError('Unexpected assembled source size')
        temporary.replace(path)
        shutil.rmtree(parts)
        return
    for attempt in range(3):
        try:
            count = 0
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
                if response.status != 200:
                    raise ValueError('Expected a complete source file')
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > (expected_size or 65536):
                        raise ValueError('Source response exceeds expected size')
                    output.write(chunk)
                    if count % (32 * 1024 * 1024) == 0:
                        print(f'{path.name}: downloaded {count // (1024 * 1024)} MiB', flush=True)
            if expected_size is not None and count != expected_size:
                raise ValueError('Truncated source file')
            temporary.replace(path)
            return
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def prepare(pole, output_root, source_dir):
    product = f'ldem_80{"n" if pole == "north" else "s"}_80m'
    label_path, image_path = source_dir / f'{product}.lbl', source_dir / f'{product}.img'
    download(BASE + label_path.name, label_path)
    label_bytes = label_path.read_bytes()
    validate_label(label_bytes.decode('ascii'), pole)
    download(BASE + image_path.name, image_path, SOURCE_BYTES)
    if image_path.stat().st_size != SOURCE_BYTES:
        raise ValueError('Unexpected source image size')
    output = output_root / pole
    output.mkdir(parents=True, exist_ok=True)
    tiles = {}
    source_hash = hashlib.sha256()
    band_hashes = []
    missing = 0
    count = math.ceil(WIDTH / TILE_SIZE)
    with image_path.open('rb') as source:
        for tile_row in range(count):
            rows = min(TILE_SIZE, HEIGHT - tile_row * TILE_SIZE)
            band = source.read(rows * WIDTH * 2)
            source_hash.update(band)
            band_hashes.append(digest(band))
            values = array.array('h')
            values.frombytes(band)
            if sys.byteorder != 'little':
                values.byteswap()
            missing += values.count(NODATA)
            for tile_col in range(count):
                columns = min(TILE_SIZE, WIDTH - tile_col * TILE_SIZE)
                tile = bytearray(b'\x00\x80' * (TILE_SIZE * TILE_SIZE))
                for row in range(rows):
                    start = (row * WIDTH + tile_col * TILE_SIZE) * 2
                    offset = row * TILE_SIZE * 2
                    tile[offset:offset + columns * 2] = band[start:start + columns * 2]
                name = f'{tile_col}-{tile_row}.bin'
                (output / name).write_bytes(tile)
                tiles[name] = digest(tile)
            print(f'{pole}: prepared tile row {tile_row + 1}/{count}', flush=True)
    manifest = {
        'format': 'lunar-dem-i16-v1', 'id': f'lola-80{pole[0]}-80m',
        'source': 'NASA/GSFC LRO LOLA', 'sourceUrl': BASE + image_path.name,
        'sourceProduct': product.upper(), 'sourceVersion': 'V2.1' if pole == 'north' else 'V2.0',
        'referenceFrame': 'MOON_ME_DE421', 'referenceRadiusM': 1737400,
        'projection': 'polar-stereographic', 'pole': pole, 'centralLongitudeDeg': 0,
        'registration': 'pixel-center', 'heightUnit': 'meter',
        'encoding': 'int16-le', 'heightScaleM': 0.5, 'noData': NODATA,
        'pixelSizeM': 80, 'width': WIDTH, 'height': HEIGHT,
        'originXM': -304000, 'originYM': 304000, 'tileSize': TILE_SIZE,
        'northDeg': 90 if pole == 'north' else -80,
        'southDeg': 80 if pole == 'north' else -90,
        'westDeg': 0, 'eastDeg': 360,
        'tiles': tiles,
        'preparation': {
            'sourceLabelSha256': digest(label_bytes), 'sourceImageSha256': source_hash.hexdigest(),
            'sourceRangesSha256': band_hashes, 'sourceNoDataCount': missing,
        },
    }
    (output / 'source.lbl').write_bytes(label_bytes)
    # Publish the manifest last, so incomplete preparations are never advertised.
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{pole}: {len(tiles)} tiles; {len(tiles) * TILE_SIZE**2 * 2} prepared bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pole', choices=['north', 'south', 'both'], default='both')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'apps/web/public/terrain')
    parser.add_argument('--source-dir', type=Path, help='Keep/reuse original NASA files in this directory')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='lunar-polar-source-') as temporary:
        source_dir = args.source_dir or Path(temporary)
        source_dir.mkdir(parents=True, exist_ok=True)
        for pole in (['north', 'south'] if args.pole == 'both' else [args.pole]):
            prepare(pole, args.output, source_dir)
