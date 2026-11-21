export interface SurfaceIndicatorPosition {
  x: number
  y: number
  offscreen: boolean
  angle: number
}

/** Project a camera-local sky direction, keeping rearward targets on the correct edge. */
export function surfaceIndicatorPosition(
  [right, up, back]: readonly number[], width: number, height: number, fovDeg: number,
): SurfaceIndicatorPosition {
  const halfWidth = width / 2, halfHeight = height / 2
  const tangent = Math.tan(fovDeg * Math.PI / 360)
  let dx = right / (tangent * width / height)
  let dy = -up / tangent
  const forward = -back
  const offscreen = forward <= 0 || Math.abs(dx) > forward || Math.abs(dy) > forward
  if (!offscreen) {
    dx /= forward
    dy /= forward
  }
  // Exactly behind the camera has no unique turn direction. Choose right.
  if (offscreen && Math.hypot(dx, dy) < 1e-10) { dx = 1; dy = 0 }
  const pixelX = dx * halfWidth, pixelY = dy * halfHeight
  const inset = Math.min(24, width / 4, height / 4)
  // Rearward directions must reach the edge even when their lateral component is small.
  const edgeScale = offscreen ? Math.min(
    (halfWidth - inset) / Math.max(Math.abs(pixelX), 1e-10),
    (halfHeight - inset) / Math.max(Math.abs(pixelY), 1e-10)) : 1
  return {
    x: halfWidth + pixelX * edgeScale,
    y: halfHeight + pixelY * edgeScale,
    offscreen,
    angle: Math.atan2(pixelY, pixelX) * 180 / Math.PI,
  }
}
