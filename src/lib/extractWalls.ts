import {
  DEFAULT_WALL_HEIGHT_M,
  EYE_HEIGHT_M,
  depthPixelToPoint,
  dirToAim,
  round2,
  wrapYaw,
} from './coords'
import type { Wall, WallState } from './types'

const BIN_DEG = 2
const BINS = Math.round(360 / BIN_DEG)

export function extractWallsFromDepth(
  depth: Float32Array,
  width: number,
  height: number,
  valid?: Uint8Array,
): { walls: Wall[]; scaleCorrection: number } {
  const stride = Math.max(1, Math.floor(width / 256))

  // Pass 1 — floor estimate (TECHNICAL-DESIGN §4.2): sample solidly-below-
  // horizon rows, where an indoor floor dominates the rays; the floor plane
  // is y ≈ const, so the median y is a robust floor estimate (RANSAC-lite
  // for the only case that matters: a floor perpendicular to gravity).
  const floorYs: number[] = []
  for (let v = Math.floor(height * 0.55); v < Math.floor(height * 0.95); v += stride) {
    for (let u = 0; u < width; u += stride) {
      const i = v * width + u
      if (valid && valid[i] === 0) continue
      const z = depth[i]
      if (!Number.isFinite(z) || z <= 0.2 || z > 30) continue
      const [, y] = depthPixelToPoint(u + 0.5, v + 0.5, z, width, height)
      if (y >= -0.02 || y < -4) continue
      floorYs.push(y)
    }
  }
  if (floorYs.length <= 20) {
    // no dominant floor (domed / open-air): flag everything, raw distances
    return { walls: extractRuns(new Float64Array(BINS).fill(Number.NaN), 1, true, true), scaleCorrection: 1 }
  }
  floorYs.sort((a, b) => a - b)
  let floorY = floorYs[Math.floor(floorYs.length / 2)]
  let scaleCorrection = EYE_HEIGHT_M / Math.abs(floorY)
  if (!Number.isFinite(scaleCorrection) || scaleCorrection <= 0) scaleCorrection = 1
  // Floor-anchor sanity (§4.2): if "metric" depth disagrees with the fixed
  // eye height by too much, correct anyway but mark the scene unreliable.
  const scaleUnreliable = scaleCorrection < 0.6 || scaleCorrection > 1.6
  if (scaleUnreliable) scaleCorrection = 1

  // Pass 2 — wall-base band (§4.3): heights 5–60 cm ABOVE the floor, i.e.
  // wall lower parts only, floor plane excluded. Bin horizontal distance by
  // yaw; per-bin median = the wall distance profile d(θ).
  const perBin: number[][] = Array.from({ length: BINS }, () => [])
  for (let v = 0; v < height; v += stride) {
    for (let u = 0; u < width; u += stride) {
      const i = v * width + u
      if (valid && valid[i] === 0) continue
      const z = depth[i]
      if (!Number.isFinite(z) || z <= 0.2 || z > 30) continue
      const [x, yRaw, zz] = depthPixelToPoint(u + 0.5, v + 0.5, z, width, height)
      const aboveFloor = (yRaw - floorY) * scaleCorrection
      if (aboveFloor < 0.05 || aboveFloor > 0.6) continue
      const horiz = Math.hypot(x, zz) * scaleCorrection
      if (horiz < 0.2 || horiz > 25) continue
      const yaw = dirToAim(x, 0, zz).yaw
      const bin = ((Math.floor(((yaw + 180) / 360) * BINS) % BINS) + BINS) % BINS
      perBin[bin].push(horiz)
    }
  }

  const profile = new Float64Array(BINS)
  for (let b = 0; b < BINS; b++) {
    const arr = perBin[b]
    if (arr.length < 1) {
      profile[b] = Number.NaN
      continue
    }
    arr.sort((a, c) => a - c)
    profile[b] = arr[Math.floor(arr.length / 2)]
  }

  const walls = extractRuns(profile, scaleCorrection, false, scaleUnreliable)
  return { walls, scaleCorrection: round2(scaleCorrection) }
}

function extractRuns(
  profile: Float64Array,
  scaleCorrection: number,
  noFloor: boolean,
  scaleUnreliable: boolean,
): Wall[] {
  const runs: { start: number; end: number; dist: number; mad: number; glass: boolean }[] = []
  let i = 0
  const madTol = 0.35
  const bins = BINS
  const binDeg = BIN_DEG
  while (i < bins) {
    while (i < bins && !Number.isFinite(profile[i])) i++
    if (i >= bins) break
    const start = i
    const samples: number[] = []
    while (i < bins && Number.isFinite(profile[i])) {
      const d = profile[i]
      if (samples.length === 0 || Math.abs(d - median(samples)) <= madTol) {
        samples.push(d)
        i++
      } else break
    }
    const end = i - 1
    const arc = (end - start + 1) * binDeg
    if (arc >= 6 && samples.length >= 2) {
      const med = median(samples)
      const mad = median(samples.map((s) => Math.abs(s - med)))
      runs.push({ start, end, dist: med, mad, glass: mad > 0.45 })
    }
  }

  return runs.map((run, idx) => {
    const yaw0 = wrapYaw(-180 + run.start * binDeg + binDeg / 2)
    const yaw1 = wrapYaw(-180 + run.end * binDeg + binDeg / 2)
    const pitch = (Math.atan2(-EYE_HEIGHT_M, run.dist) * 180) / Math.PI
    const arc = (run.end - run.start + 1) * binDeg
    const widthM = 2 * run.dist * Math.tan(((arc / 2) * Math.PI) / 180)
    let confidence = (1 - Math.min(1, run.mad / 0.5)) * Math.min(1, arc / 25)
    if (noFloor) confidence = Math.min(confidence, 0.3)
    if (scaleUnreliable) confidence *= 0.7
    if (run.glass) confidence *= 0.4
    let state: WallState
    if (run.glass || confidence < 0.4) state = 'rejected'
    else if (confidence < 0.75) state = 'review'
    else state = 'auto'
    return {
      id: `w${idx + 1}`,
      seam: [
        { yaw: round2(yaw0), pitch: round2(pitch) },
        { yaw: round2(yaw1), pitch: round2(pitch) },
      ],
      heightM: DEFAULT_WALL_HEIGHT_M,
      state,
      confidence: round2(confidence),
      source: 'depth',
      notes: run.glass
        ? 'glass-suspect'
        : noFloor
          ? 'no-floor-plane'
          : scaleUnreliable
            ? 'scale-unreliable'
            : '',
      widthM: round2(widthM),
      distanceM: round2(run.dist),
    }
  })
}

function median(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}

export function syntheticBoxRoomDepth(
  width = 128,
  height = 64,
  halfSizeM = 3,
): { depth: Float32Array; valid: Uint8Array } {
  const depth = new Float32Array(width * height)
  const valid = new Uint8Array(width * height)
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const lon = (u / width) * 2 * Math.PI - Math.PI
      const lat = (v / height) * Math.PI - Math.PI / 2
      const dx = Math.cos(lat) * Math.sin(lon)
      const dy = Math.sin(lat)
      const dz = -Math.cos(lat) * Math.cos(lon)
      let tMin = Infinity
      if (Math.abs(dx) > 1e-6) {
        const t = (Math.sign(dx) * halfSizeM) / dx
        if (t > 0) tMin = Math.min(tMin, t)
      }
      if (Math.abs(dz) > 1e-6) {
        const t = (Math.sign(dz) * halfSizeM) / dz
        if (t > 0) tMin = Math.min(tMin, t)
      }
      if (dy < -1e-6) {
        const t = -EYE_HEIGHT_M / dy
        if (t > 0) tMin = Math.min(tMin, t)
      }
      if (dy > 1e-6) {
        const t = 1.2 / dy
        if (t > 0) tMin = Math.min(tMin, t)
      }
      const i = v * width + u
      if (!Number.isFinite(tMin) || tMin > 40) {
        depth[i] = 40
        valid[i] = 0
      } else {
        depth[i] = tMin
        valid[i] = 1
      }
    }
  }
  return { depth, valid }
}