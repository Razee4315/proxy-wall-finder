import { describe, expect, it } from 'vitest'
import { aimToDir, depthPixelToPoint, dirToAim, wrapYaw } from './coords'

describe('coords', () => {
  it('round-trips aim at yaw 0 pitch 0 toward -Z', () => {
    const [x, y, z] = aimToDir(0, 0)
    expect(y).toBeCloseTo(0, 5)
    expect(z).toBeCloseTo(-1, 5)
    expect(x).toBeCloseTo(0, 5)
    const aim = dirToAim(x, y, z)
    expect(aim.yaw).toBeCloseTo(0, 4)
    expect(aim.pitch).toBeCloseTo(0, 4)
  })
  it('wraps yaw', () => {
    expect(wrapYaw(190)).toBeCloseTo(-170, 5)
  })
  it('maps equirect pixels like the image: row 0 = zenith, bottom = nadir', () => {
    // top row is UP, bottom row is DOWN, center row is level
    const [, top] = depthPixelToPoint(0, 0, 1, 100, 100)
    const [, mid] = depthPixelToPoint(0, 50, 1, 100, 100)
    const [, bottom] = depthPixelToPoint(0, 99, 1, 100, 100)
    expect(top).toBeCloseTo(1, 5)
    expect(mid).toBeCloseTo(0, 5)
    expect(bottom).toBeLessThan(-0.99)
    // center column is yaw 0 (-Z); right half is +yaw (+X at yaw 90)
    const [rx, , rz] = depthPixelToPoint(75, 50, 1, 100, 100)
    expect(rx).toBeCloseTo(1, 5)
    expect(rz).toBeCloseTo(0, 5)
  })
})
