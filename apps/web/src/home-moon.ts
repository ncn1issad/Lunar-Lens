import { Body, Illumination, RotationAxis } from 'astronomy-engine'
import { Matrix4, Quaternion, Vector3 } from 'three'

interface MoonState {
  orientation: Quaternion
  sunDirection: Vector3
}

/** Advance a date preview without flipping the light through the Moon's centre. */
export function animateMoonState(current: MoonState, target: MoonState, elapsedMs: number) {
  if (current.orientation.equals(target.orientation) && current.sunDirection.equals(target.sunDirection)) return false
  if (current.orientation.angleTo(target.orientation) < 0.0001 && current.sunDirection.angleTo(target.sunDirection) < 0.0001) {
    current.orientation.copy(target.orientation)
    current.sunDirection.copy(target.sunDirection)
    return true
  }
  // Keep the phase change visible for roughly three quarters of a second.
  const blend = 1 - Math.exp(-Math.max(0, Math.min(elapsedMs, 64)) / 250)
  current.orientation.slerp(target.orientation, blend)
  const lightRotation = new Quaternion().setFromUnitVectors(current.sunDirection, target.sunDirection)
  lightRotation.slerp(new Quaternion(), 1 - blend)
  current.sunDirection.applyQuaternion(lightRotation).normalize()
  return true
}

/** Earth-centred, lunar-north-up presentation for the home page, in UTC. */
export function getHomeMoonState(date: Date) {
  const illumination = Illumination(Body.Moon, date)
  const axis = RotationAxis(Body.Moon, date)
  const north = new Vector3(axis.north.x, axis.north.y, axis.north.z)
  const earthward = new Vector3(
    illumination.gc.x, illumination.gc.y, illumination.gc.z,
  ).negate().normalize()
  const sunward = new Vector3(
    illumination.hc.x, illumination.hc.y, illumination.hc.z,
  ).negate().normalize()

  // Project J2000 vectors into a view with Earth at +Z and lunar north up.
  const right = new Vector3().crossVectors(north, earthward).normalize()
  const up = new Vector3().crossVectors(earthward, right).normalize()
  const toView = (vector: Vector3) => new Vector3(
    vector.dot(right), vector.dot(up), vector.dot(earthward),
  )

  // IAU prime meridian: rotate the equator's ascending node by spin angle W.
  const ra = axis.ra * Math.PI / 12
  const spin = (axis.spin % 360) * Math.PI / 180
  const node = new Vector3(-Math.sin(ra), Math.cos(ra), 0)
  const tangent = new Vector3().crossVectors(north, node)
  const prime = node.multiplyScalar(Math.cos(spin)).addScaledVector(tangent, Math.sin(spin))
  const east = new Vector3().crossVectors(north, prime)

  // SphereGeometry's map has longitude 0 at +X, north at +Y, east at -Z.
  const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(
    toView(prime), toView(north), toView(east).negate(),
  ))

  return { orientation, sunDirection: toView(sunward) }
}
