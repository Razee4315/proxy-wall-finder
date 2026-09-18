export const GROUND_Y = -62
export const UNITS_PER_METER = 40
export const EYE_HEIGHT_M = 1.55
export const DEFAULT_WALL_HEIGHT_M = 2.7

export type Aim = { yaw: number; pitch: number }

export function aimToDir(yaw: number, pitch: number): [number, number, number] {
  const phi = ((90 - pitch) * Math.PI) / 180
  const theta = ((180 - yaw) * Math.PI) / 180
  return [Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta)]
}

export function dirToAim(x: number, y: number, z: number): Aim {
  const len = Math.hypot(x, y, z) || 1
  const pitch = (Math.asin(y / len) * 180) / Math.PI
  let yaw = 180 - (Math.atan2(x, z) * 180) / Math.PI
  if (yaw > 180) yaw -= 360
  if (yaw <= -180) yaw += 360
  return { yaw, pitch }
}

export function depthPixelToPoint(
  u: number,
  v: number,
  z: number,
  width: number,
  height: number,
): [number, number, number] {
  const lon = (u / width) * 2 * Math.PI - Math.PI
  // Equirect row 0 is the zenith: lat +π/2 at the top, −π/2 at the bottom.
  const lat = Math.PI / 2 - (v / height) * Math.PI
  return [
    Math.cos(lat) * Math.sin(lon) * z,
    Math.sin(lat) * z,
    -Math.cos(lat) * Math.cos(lon) * z,
  ]
}

export function wrapYaw(yaw: number): number {
  let y = yaw
  while (y > 180) y -= 360
  while (y <= -180) y += 360
  return y
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
