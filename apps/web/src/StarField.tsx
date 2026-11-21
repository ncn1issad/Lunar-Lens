// Fixed positions keep the star field still across renders and page reloads.
const stars = Array.from({ length: 95 }, (_, index) => {
  const seed = index + 1
  const random = (offset: number) => {
    const value = Math.sin(seed * 127.1 + offset * 311.7) * 43758.5453
    return value - Math.floor(value)
  }
  return {
    x: random(1) * 1600,
    y: random(2) * 1000,
    radius: 0.5 + random(3) * 0.9,
    opacity: 0.15 + random(4) * 0.5,
  }
})

export default function StarField() {
  return (
    <svg className="star-field" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {stars.map((star, index) => (
        <circle key={index} cx={star.x} cy={star.y} r={star.radius} opacity={star.opacity} />
      ))}
    </svg>
  )
}
