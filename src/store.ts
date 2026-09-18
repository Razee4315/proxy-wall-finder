import { create } from 'zustand'
import { wrapYaw } from './lib/coords'
import { extractWallsFromDepth } from './lib/extractWalls'
import type { DepthMeta, Scene, Wall, WallState } from './lib/types'

const STORAGE_KEY = 'pwf-session-v1'

type Store = {
  scenes: Scene[]
  activeSceneId: string | null
  selectedWallId: string | null
  status: string
  hydrate: () => void
  persist: () => void
  addPanorama: (file: File) => Promise<void>
  loadDepthForActive: (npzFile: File, jsonFile?: File) => Promise<void>
  setActiveScene: (id: string) => void
  selectWall: (id: string | null) => void
  setWallState: (id: string, state: WallState) => void
  nudgeSeam: (id: string, end: 0 | 1, dYaw: number) => void
  setWallHeight: (id: string, heightM: number) => void
  removeScene: (id: string) => void
}

function patchWall(
  scenes: Scene[],
  activeSceneId: string | null,
  wallId: string,
  fn: (w: Wall) => Wall,
): Scene[] {
  if (!activeSceneId) return scenes
  return scenes.map((s) =>
    s.id === activeSceneId
      ? { ...s, walls: s.walls.map((w) => (w.id === wallId ? fn(w) : w)) }
      : s,
  )
}

export const useStore = create<Store>((set, get) => ({
  scenes: [],
  activeSceneId: null,
  selectedWallId: null,
  status: 'Drop panoramas to begin',

  hydrate: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw) as {
        scenes: Array<{ id: string; imageName: string; walls: Wall[]; depthMeta?: DepthMeta }>
        activeSceneId: string | null
        selectedWallId: string | null
      }
      set({
        scenes: data.scenes.map((s) => ({
          id: s.id,
          imageName: s.imageName,
          imageUrl: '',
          walls: s.walls,
          depth: s.depthMeta
            ? {
                width: s.depthMeta.resolution[0],
                height: s.depthMeta.resolution[1],
                values: new Float32Array(0),
                meta: s.depthMeta,
              }
            : undefined,
        })),
        activeSceneId: data.activeSceneId,
        selectedWallId: data.selectedWallId,
        status: 'Restored session — re-drop images/depth to view',
      })
    } catch {
      /* ignore corrupt session */
    }
  },

  persist: () => {
    const { scenes, activeSceneId, selectedWallId } = get()
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scenes: scenes.map((s) => ({
          id: s.id,
          imageName: s.imageName,
          walls: s.walls,
          depthMeta: s.depth?.meta,
        })),
        activeSceneId,
        selectedWallId,
      }),
    )
  },

  addPanorama: async (file) => {
    const id = file.name.replace(/\.[^.]+$/, '')
    const imageUrl = URL.createObjectURL(file)
    set((st) => {
      const hit = st.scenes.find((s) => s.id === id)
      if (hit?.imageUrl) URL.revokeObjectURL(hit.imageUrl)
      if (hit) {
        return {
          scenes: st.scenes.map((s) =>
            s.id === id ? { ...s, imageName: file.name, imageUrl } : s,
          ),
          activeSceneId: id,
          status: `Updated ${file.name}`,
        }
      }
      return {
        scenes: [...st.scenes, { id, imageName: file.name, imageUrl, walls: [] }],
        activeSceneId: id,
        status: `Added ${file.name}`,
      }
    })
    get().persist()
  },

  loadDepthForActive: async (npzFile, jsonFile) => {
    const activeId = get().activeSceneId
    if (!activeId) {
      set({ status: 'Select a scene before loading depth' })
      return
    }
    set({ status: 'Parsing depth…' })
    try {
      const { depth, valid, width, height } = parseDepthNpz(new Uint8Array(await npzFile.arrayBuffer()))
      let meta: DepthMeta = {
        model: 'DAP',
        weights: 'model.pth',
        resolution: [width, height],
        metric: true,
        scaleCorrection: 1,
        date: new Date().toISOString(),
      }
      if (jsonFile) {
        const j = JSON.parse(await jsonFile.text()) as Record<string, unknown>
        const res = (j.depth_resolution ?? j.resolution) as number[] | undefined
        meta = {
          model: String(j.model ?? 'DAP'),
          modelCommit: j.model_commit ? String(j.model_commit) : undefined,
          weights: String(j.weights ?? 'model.pth'),
          resolution: res
            ? [Number(res[1] ?? width), Number(res[0] ?? height)]
            : [width, height],
          metric: j.metric !== false,
          scaleCorrection: 1,
          date: String(j.date ?? new Date().toISOString()),
        }
      }
      const { walls, scaleCorrection } = extractWallsFromDepth(depth, width, height, valid)
      meta.scaleCorrection = scaleCorrection
      set((st) => ({
        scenes: st.scenes.map((s) =>
          s.id === activeId
            ? { ...s, walls, depth: { width, height, values: depth, valid, meta } }
            : s,
        ),
        selectedWallId: walls[0]?.id ?? null,
        status: `Extracted ${walls.length} walls (scale ${scaleCorrection})`,
      }))
      get().persist()
    } catch (err) {
      set({ status: `Depth load failed: ${(err as Error).message}` })
    }
  },

  setActiveScene: (id) => {
    set({ activeSceneId: id, selectedWallId: null })
    get().persist()
  },

  selectWall: (id) => set({ selectedWallId: id }),

  setWallState: (id, state) => {
    set((st) => ({ scenes: patchWall(st.scenes, st.activeSceneId, id, (w) => ({ ...w, state })) }))
    get().persist()
  },

  nudgeSeam: (id, end, dYaw) => {
    set((st) => ({
      scenes: patchWall(st.scenes, st.activeSceneId, id, (w) => {
        const seam: Wall['seam'] = [{ ...w.seam[0] }, { ...w.seam[1] }]
        seam[end] = { ...seam[end], yaw: wrapYaw(seam[end].yaw + dYaw) }
        return { ...w, seam, state: 'edited' }
      }),
    }))
    get().persist()
  },

  setWallHeight: (id, heightM) => {
    set((st) => ({
      scenes: patchWall(st.scenes, st.activeSceneId, id, (w) => ({
        ...w,
        heightM,
        state: 'edited',
      })),
    }))
    get().persist()
  },

  removeScene: (id) => {
    set((st) => {
      const scene = st.scenes.find((s) => s.id === id)
      if (scene?.imageUrl) URL.revokeObjectURL(scene.imageUrl)
      const scenes = st.scenes.filter((s) => s.id !== id)
      return {
        scenes,
        activeSceneId: st.activeSceneId === id ? scenes[0]?.id ?? null : st.activeSceneId,
        selectedWallId: null,
      }
    })
    get().persist()
  },
}))

function parseDepthNpz(bytes: Uint8Array): {
  depth: Float32Array
  valid?: Uint8Array
  width: number
  height: number
} {
  const files = new Map<string, Uint8Array>()
  let o = 0
  while (o + 30 < bytes.length) {
    if (bytes[o] !== 0x50 || bytes[o + 1] !== 0x4b || bytes[o + 2] !== 3 || bytes[o + 3] !== 4) break
    const method = bytes[o + 8] | (bytes[o + 9] << 8)
    const comp =
      bytes[o + 18] | (bytes[o + 19] << 8) | (bytes[o + 20] << 16) | (bytes[o + 21] << 24)
    const nameLen = bytes[o + 26] | (bytes[o + 27] << 8)
    const extraLen = bytes[o + 28] | (bytes[o + 29] << 8)
    const name = new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nameLen))
    const start = o + 30 + nameLen + extraLen
    if (method !== 0) throw new Error(`Compressed NPZ entry ${name} not supported`)
    files.set(name.replace(/^\.\//, ''), bytes.subarray(start, start + comp))
    o = start + comp
  }
  const depthKey = [...files.keys()].find((k) => /depth.*\.npy$/i.test(k))
  if (!depthKey) throw new Error('NPZ missing depth.npy')
  const parsed = parseNpy(files.get(depthKey)!)
  const height = parsed.shape[0]
  const width = parsed.shape[1]
  const depth = Float32Array.from(parsed.values)
  let valid: Uint8Array | undefined
  const validKey = [...files.keys()].find((k) => /valid.*\.npy$/i.test(k))
  if (validKey) {
    valid = Uint8Array.from(parseNpy(files.get(validKey)!).values.map((x) => (x > 0 ? 1 : 0)))
  }
  return { depth, valid, width, height }
}

function parseNpy(data: Uint8Array): { values: number[]; shape: number[] } {
  if (data[0] !== 0x93) throw new Error('Not NPY')
  const major = data[6]
  const headerLen =
    major === 1
      ? data[8] | (data[9] << 8)
      : data[8] | (data[9] << 8) | (data[10] << 16) | (data[11] << 24)
  const headerStart = major === 1 ? 10 : 12
  const header = new TextDecoder().decode(data.subarray(headerStart, headerStart + headerLen))
  const shapeMatch = /'shape':\s*\(([^)]*)\)/.exec(header)
  const descrMatch = /'descr':\s*'([^']+)'/.exec(header)
  if (!shapeMatch || !descrMatch) throw new Error('Bad NPY header')
  const shape = shapeMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
  const descr = descrMatch[1]
  const body = data.subarray(headerStart + headerLen)
  const count = shape.reduce((a, b) => a * b, 1)
  const values = new Array<number>(count)
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  if (descr.includes('f2')) {
    for (let i = 0; i < count; i++) values[i] = f16(view.getUint16(i * 2, true))
  } else if (descr.includes('f4')) {
    for (let i = 0; i < count; i++) values[i] = view.getFloat32(i * 4, true)
  } else if (descr.includes('u1')) {
    for (let i = 0; i < count; i++) values[i] = body[i]
  } else throw new Error(`Unsupported dtype ${descr}`)
  return { values, shape }
}

function f16(u: number): number {
  const s = (u & 0x8000) >> 15
  const e = (u & 0x7c00) >> 10
  const f = u & 0x03ff
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? Number.NaN : s ? -Infinity : Infinity
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024)
}
