import type { TimelinePositions } from '@lunar-lense/contracts'

export const visibilityColors = {
  both: '#a6e3a1',
  sun: '#f9e2af',
  earth: '#b4befe',
  neither: '#6c7086',
} as const

/** Each API sample's visibility applies until the next sample, without inventing rise/set times. */
export function visibilityGradient(positions: TimelinePositions): string {
  const first = Date.parse(positions.earth[0]!.timestamp)
  const duration = Date.parse(positions.earth.at(-1)!.timestamp) - first
  const colorAt = (index: number) => {
    const earth = positions.earth[index]!.isVisible, sun = positions.sun[index]!.isVisible
    return visibilityColors[earth ? (sun ? 'both' : 'earth') : (sun ? 'sun' : 'neither')]
  }
  if (duration === 0) return colorAt(0)
  const stops: string[] = []
  let color = colorAt(0), start = 0
  for (let index = 1; index < positions.earth.length - 1; index++) {
    const next = colorAt(index)
    if (next === color) continue
    const end = (Date.parse(positions.earth[index]!.timestamp) - first) / duration * 100
    stops.push(`${color} ${start}% ${end}%`)
    color = next
    start = end
  }
  stops.push(`${color} ${start}% 100%`)
  return `linear-gradient(to right, ${stops.join(', ')})`
}
