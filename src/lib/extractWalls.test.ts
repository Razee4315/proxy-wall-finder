import { describe, expect, it } from 'vitest'
import { extractWallsFromDepth, syntheticBoxRoomDepth } from './extractWalls'

describe('extractWallsFromDepth', () => {
  it('finds walls in a synthetic box room', () => {
    const { depth, valid } = syntheticBoxRoomDepth(256, 128, 3)
    const { walls, scaleCorrection } = extractWallsFromDepth(depth, 256, 128, valid)
    expect(scaleCorrection).toBeGreaterThan(0.5)
    expect(scaleCorrection).toBeLessThanOrEqual(1.6)
    expect(walls.length).toBeGreaterThanOrEqual(2)
    expect(walls.every((w) => w.seam[0].pitch < 0 && w.seam[1].pitch < 0)).toBe(true)
  })
})
