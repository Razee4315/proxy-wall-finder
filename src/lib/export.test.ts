import { describe, expect, it } from 'vitest'
import { formatSceneProxy, isExportable } from './export'
import type { Scene } from './types'

describe('export', () => {
  it('exports only accepted-like walls', () => {
    const scene: Scene = {
      id: 'room',
      imageName: 'room.jpg',
      imageUrl: '',
      walls: [
        {
          id: 'w1',
          seam: [
            { yaw: 10, pitch: -30 },
            { yaw: 40, pitch: -28 },
          ],
          heightM: 2.7,
          state: 'accepted',
          confidence: 0.9,
          source: 'depth',
          notes: '',
        },
        {
          id: 'w2',
          seam: [
            { yaw: 50, pitch: -20 },
            { yaw: 80, pitch: -20 },
          ],
          heightM: 2.7,
          state: 'rejected',
          confidence: 0.2,
          source: 'depth',
          notes: 'glass-suspect',
        },
      ],
    }
    expect(isExportable(scene.walls[0]!)).toBe(true)
    expect(isExportable(scene.walls[1]!)).toBe(false)
    const text = formatSceneProxy(scene)
    expect(text).toContain('proxy: {')
    expect(text).toContain('seam:')
  })
})
