import { round2 } from './coords'
import type { Scene, Wall } from './types'
import { EXPORTABLE_STATES } from './types'

export function isExportable(wall: Wall): boolean {
  if (!EXPORTABLE_STATES.includes(wall.state)) return false
  const [a, b] = wall.seam
  return a.pitch < 0 && b.pitch < 0 && wall.heightM > 0 && wall.heightM <= 6
}

export function formatSceneProxy(scene: Scene): string {
  const walls = scene.walls.filter(isExportable)
  const lines = walls.map((wall) => {
    const [a, b] = wall.seam
    const seam =
      `seam: [{ yaw: ${round2(a.yaw)}, pitch: ${round2(a.pitch)} }, ` +
      `{ yaw: ${round2(b.yaw)}, pitch: ${round2(b.pitch)} }]`
    const height =
      Math.abs(wall.heightM - 2.7) < 0.001 ? '' : `, heightM: ${round2(wall.heightM)}`
    return `    { ${seam}${height} },`
  })
  const date = new Date().toISOString().slice(0, 10)
  return [
    `// Proxy Wall Finder — ${scene.id} (${walls.length} walls, ${date})`,
    'proxy: {',
    '  walls: [',
    ...lines,
    '  ],',
    '},',
  ].join('\n')
}

export function formatAllProxy(scenes: Scene[]): string {
  return scenes.map(formatSceneProxy).join('\n\n')
}

export function buildSessionJson(scenes: Scene[]): string {
  return JSON.stringify(
    {
      version: 1,
      savedAt: new Date().toISOString(),
      scenes: Object.fromEntries(
        scenes.map((s) => [
          s.id,
          {
            image: s.imageName,
            depth: s.depth
              ? {
                  model: s.depth.meta.model,
                  modelCommit: s.depth.meta.modelCommit,
                  weights: s.depth.meta.weights,
                  resolution: s.depth.meta.resolution,
                  metric: s.depth.meta.metric,
                  scaleCorrection: s.depth.meta.scaleCorrection,
                  date: s.depth.meta.date,
                }
              : undefined,
            walls: s.walls,
          },
        ]),
      ),
    },
    null,
    2,
  )
}
