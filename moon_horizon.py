#!/usr/bin/env python3
"""Draw Earth and the Sun above a lunar site's horizon using JPL Horizons."""

import argparse
import csv
from dataclasses import dataclass
from datetime import date
import io
import json
import math
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
TARGETS = (("Earth", "399", "E"), ("Sun", "10", "S"))


class HorizonsError(Exception):
    """A network error or unusable Horizons response."""


@dataclass(frozen=True)
class Position:
    name: str
    symbol: str
    azimuth: float
    elevation: float


def query_parameters(day, longitude, latitude, target_id):
    """Request exactly one airless, topocentric azimuth/elevation sample."""
    settings = {
        "COMMAND": target_id,
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "coord@301",  # A user-defined surface site on the Moon.
        "COORD_TYPE": "GEODETIC",
        "SITE_COORD": f"{longitude},{latitude},0",  # lon, lat, altitude in km
        "TLIST": f"{day.isoformat()} 00:00:00",
        "TLIST_TYPE": "CAL",
        "TIME_TYPE": "UT",  # Horizons uses UTC for modern dates.
        "CAL_TYPE": "GREGORIAN",
        "TIME_DIGITS": "SECONDS",
        "QUANTITIES": "4",  # Apparent azimuth and elevation of target center.
        "APPARENT": "AIRLESS",
        "CSV_FORMAT": "YES",
        "ELEV_CUT": "-90",  # Keep results even when below the horizon.
    }
    return {"format": "json", **{key: f"'{value}'" for key, value in settings.items()}}


def parse_position(payload, name, symbol):
    """Read the labeled CSV table inside the API's JSON result."""
    if not isinstance(payload, dict):
        raise HorizonsError("Horizons returned an unexpected JSON response.")
    if payload.get("error"):
        raise HorizonsError(f"Horizons: {str(payload['error'])[:1000]}")
    result = payload.get("result")
    if not isinstance(result, str):
        raise HorizonsError("Horizons response has no ephemeris text.")
    before, start, remainder = result.partition("$$SOE")
    table, end, _ = remainder.partition("$$EOE")
    if not start or not end:
        raise HorizonsError(f"Horizons returned no ephemeris table: {result.strip()[:1000]}")

    try:
        header_line = next(
            line for line in reversed(before.splitlines()) if "Azi_(a-app)" in line
        )
        header = [field.strip() for field in next(csv.reader([header_line]))]
        rows = list(csv.reader(io.StringIO(table.strip())))
        if len(rows) != 1:
            raise ValueError("expected exactly one time sample")
        row = rows[0]
        azimuth = float(row[header.index("Azi_(a-app)")])
        elevation = float(row[header.index("Elev_(a-app)")])
        if not math.isfinite(azimuth) or not 0 <= azimuth <= 360:
            raise ValueError("invalid azimuth")
        if not math.isfinite(elevation) or not -90 <= elevation <= 90:
            raise ValueError("invalid elevation")
    except (StopIteration, ValueError, IndexError, csv.Error) as exc:
        raise HorizonsError(f"Cannot read {name}'s azimuth/elevation: {exc}") from exc
    return Position(name, symbol, azimuth % 360, elevation)


def fetch_position(day, longitude, latitude, name, target_id, symbol):
    params = query_parameters(day, longitude, latitude, target_id)
    request = Request(
        f"{API_URL}?{urlencode(params)}",
        headers={"User-Agent": "LunarHorizonASCII/1.0", "Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except HTTPError as exc:
        raise HorizonsError(f"Horizons HTTP error {exc.code} while fetching {name}.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise HorizonsError(f"Cannot reach Horizons for {name}: {exc}") from exc
    except (ValueError, UnicodeError) as exc:
        raise HorizonsError(f"Horizons returned invalid JSON for {name}.") from exc
    return parse_position(payload, name, symbol)


def render_panorama(positions, width=97, height=19):
    """Map azimuth 0..360 horizontally and elevation 90..0 vertically."""
    if width < 41 or height < 7:
        raise ValueError("The panorama needs at least 41 columns and 7 rows.")
    grid = [[" " for _ in range(width)] for _ in range(height)]
    grid[-1] = ["=" for _ in range(width)]
    occupied = set()
    for position in positions:
        if position.elevation < 0:
            continue
        column = round((position.azimuth % 360) / 360 * (width - 1))
        row = round((90 - position.elevation) / 90 * (height - 1))
        cell = (row, column)
        grid[row][column] = "*" if cell in occupied else position.symbol
        occupied.add(cell)

    lines = ["Elevation (deg)                 Lunar sky, 360-degree panorama"]
    for row, cells in enumerate(grid):
        # Seven altitude labels, including the zenith and horizon.
        label_rows = {round(i * (height - 1) / 6) for i in range(7)}
        label = f"{90 - row * 90 / (height - 1):5.1f}" if row in label_rows else "     "
        lines.append(f"{label} |{''.join(cells)}|")
    lines.append("      |" + "." * width + "|  Lunar surface")
    for labels in (("N", "E", "S", "W", "N"), ("0", "90", "180", "270", "360")):
        axis = [" "] * width
        for index, label in enumerate(labels):
            center = round(index * (width - 1) / 4)
            start = max(0, min(width - len(label), center - len(label) // 2))
            axis[start:start + len(label)] = label
        lines.append("       " + "".join(axis).rstrip())
    lines.extend((
        "       Azimuth (deg), clockwise from north",
        "",
        "E = Earth; S = Sun; * = both centers in the same character cell",
        "Markers show centers, not disk sizes. '=' is the ideal flat horizon.",
    ))
    for position in positions:
        if position.elevation > 0:
            status = "center above horizon"
        elif position.elevation < 0:
            status = "center below horizon, omitted from sky"
        else:
            status = "center on horizon"
        lines.append(
            f"{position.name:5}  az {position.azimuth:7.2f} deg"
            f"  el {position.elevation:+7.2f} deg  {status}"
        )
    return "\n".join(lines)


def parse_date(value):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise argparse.ArgumentTypeError("use a date in YYYY-MM-DD format")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def coordinate(low, high):
    def parse(value):
        try:
            number = float(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("enter a number in degrees") from exc
        if not math.isfinite(number) or not low <= number <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high} degrees")
        return number
    return parse


def bounded_int(low, high):
    def parse(value):
        try:
            number = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("enter a whole number") from exc
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}")
        return number
    return parse


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Draw Earth's and the Sun's positions from the Moon at 00:00:00 UTC.",
        epilog="Coordinates are lunar, east-positive longitude and north-positive latitude.",
    )
    parser.add_argument("--date", required=True, type=parse_date, help="Gregorian YYYY-MM-DD")
    parser.add_argument("--longitude", required=True, type=coordinate(-180, 360),
                        help="lunar longitude in degrees, east positive (-180 to 360)")
    parser.add_argument("--latitude", required=True, type=coordinate(-90, 90),
                        help="lunar latitude in degrees, north positive (-90 to 90)")
    parser.add_argument("--width", type=bounded_int(41, 201), default=97,
                        help="panorama columns, excluding labels (default: 97)")
    parser.add_argument("--height", type=bounded_int(7, 61), default=19,
                        help="sky rows, including horizon (default: 19)")
    args = parser.parse_args(argv)
    try:
        # Query sequentially to respect the JPL API's one-request-at-a-time policy.
        positions = [
            fetch_position(args.date, args.longitude, args.latitude, name, target, symbol)
            for name, target, symbol in TARGETS
        ]
    except HorizonsError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    timescale = "UTC" if args.date.year >= 1962 else "UT1"
    print(f"Moon horizon | {args.date.isoformat()} 00:00:00 {timescale}")
    print(f"Site: longitude {args.longitude:g} deg E, latitude {args.latitude:g} deg N")
    print("Observer altitude: 0 km above the lunar reference sphere | NASA/JPL Horizons\n")
    print(render_panorama(positions, args.width, args.height))
    return 0


if __name__ == "__main__":
    sys.exit(main())
