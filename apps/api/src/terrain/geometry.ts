const DEG = Math.PI / 180;

export function normalizeLongitude(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}

/** Great-circle destination on the DEM reference sphere. At a pole, longitude defines north. */
export function destination(
  latitudeDeg: number, longitudeDeg: number, azimuthDeg: number, distanceM: number, radiusM: number,
): { latitude: number; longitude: number } {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const az = azimuthDeg * DEG;
  const arc = distanceM / radiusM;
  // Rotate local north/east into Cartesian coordinates. Unlike the usual
  // longitude atan2 formula this remains well-defined at the exact poles.
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon), sinLon = Math.sin(lon);
  const north = Math.cos(az) * Math.sin(arc);
  const east = Math.sin(az) * Math.sin(arc);
  const radial = Math.cos(arc);
  const x = radial * cosLat * cosLon - north * sinLat * cosLon - east * sinLon;
  const y = radial * cosLat * sinLon - north * sinLat * sinLon + east * cosLon;
  const z = radial * sinLat + north * cosLat;
  return {
    latitude: Math.atan2(z, Math.hypot(x, y)) / DEG,
    longitude: normalizeLongitude(Math.atan2(y, x) / DEG),
  };
}

/** Apparent elevation above the observer's local horizontal, with lunar curvature. */
export function apparentElevationDeg(
  distanceM: number, terrainHeightM: number, observerHeightM: number, radiusM: number,
): number {
  const angle = distanceM / radiusM;
  // 1 - cos(angle) loses precision for the closest samples. Use 2*sin²(angle/2).
  const up = terrainHeightM - observerHeightM
    - 2 * (radiusM + terrainHeightM) * Math.sin(angle / 2) ** 2;
  const forward = (radiusM + terrainHeightM) * Math.sin(angle);
  return Math.atan2(up, forward) / DEG;
}
