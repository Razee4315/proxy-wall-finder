import type { Aim } from './coords'

export type WallState = 'auto' | 'review' | 'accepted' | 'edited' | 'rejected'

export type Wall = {
  id: string
  seam: [Aim, Aim]
  heightM: number
  state: WallState
  confidence: number
  source: 'depth' | 'manual'
  notes: string
  widthM?: number
  distanceM?: number
}

export type DepthMeta = {
  model: string
  modelCommit?: string
  weights: string
  resolution: [number, number]
  metric: boolean
  scaleCorrection: number
  date: string
}

export type Scene = {
  id: string
  imageName: string
  imageUrl: string
  walls: Wall[]
  depth?: {
    width: number
    height: number
    values: Float32Array
    valid?: Uint8Array
    meta: DepthMeta
  }
}

export const EXPORTABLE_STATES: WallState[] = ['auto', 'accepted', 'edited']
