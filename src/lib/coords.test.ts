import { describe, expect, it } from 'vitest'
import { aimToDir, dirToAim, wrapYaw } from './coords'

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
})
