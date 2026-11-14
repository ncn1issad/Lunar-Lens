"""Verified, resumable NASA source downloads for offline terrain preparation."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import math
import shutil
import time
import urllib.request


def digest(data):
    return hashlib.sha256(data).hexdigest()


def download(url, path, expected_size=None):
    if path.exists() and (expected_size is None or path.stat().st_size == expected_size):
        return
    temporary = path.with_suffix(path.suffix + '.part')
    if expected_size is not None:
        # Small resumable ranges avoid restarting a large source transfer.
        # Eight connections are used only during offline preparation, never by the API.
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
                    started = time.monotonic()
                    request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{expected_size}':
                            raise ValueError('Server returned an unexpected source range')
                        data = bytearray()
                        while len(data) < end - start + 2:
                            block = response.read(min(65536, end - start + 2 - len(data)))
                            if not block:
                                break
                            data.extend(block)
                            if time.monotonic() - started > 120:
                                raise TimeoutError('Source range exceeded its two-minute transfer budget')
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
        with ThreadPoolExecutor(max_workers=8) as pool:
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
