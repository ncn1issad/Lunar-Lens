import type { OrthographicCamera } from 'three'

interface MoonFrame {
  x: number
  y: number
  width: number
  height: number
}

/** Position the globe in a layout slot while rendering across the whole canvas. */
export function frameMoonInViewport(
  camera: OrthographicCamera,
  width: number,
  height: number,
  frame: MoonFrame,
  centered = false,
) {
  const diameter = Math.min(frame.width, frame.height)
  const halfHeight = height / diameter
  camera.left = -halfHeight * width / height
  camera.right = -camera.left
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.setViewOffset(
    width, height,
    centered ? 0 : width / 2 - (frame.x + frame.width / 2),
    centered ? 0 : height / 2 - (frame.y + frame.height / 2),
    width, height,
  )
}
