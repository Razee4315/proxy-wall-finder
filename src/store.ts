import { create } from 'zustand'
import { round2, wrapYaw } from './lib/coords'
import type { Aim } from './lib/coords'
import { extractWallsFromDepth } from './lib/extractWalls'
import { parseDepthNpz } from './lib/npz'
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
  setSeamAim: (id: string, end: 0 | 1, aim: Aim) => void
  setWallSeam: (id: string, seam: [Aim, Aim]) => void
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
      const { depth, valid, width, height } = await parseDepthNpz(
        new Uint8Array(await npzFile.arrayBuffer()),
      )
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

  setSeamAim: (id, end, aim) => {
    set((st) => ({
      scenes: patchWall(st.scenes, st.activeSceneId, id, (w) => {
        const seam: Wall['seam'] = [{ ...w.seam[0] }, { ...w.seam[1] }]
        seam[end] = { yaw: round2(aim.yaw), pitch: round2(aim.pitch) }
        return { ...w, seam, state: 'edited' }
      }),
    }))
    get().persist()
  },

  setWallSeam: (id, seam) => {
    set((st) => ({
      scenes: patchWall(st.scenes, st.activeSceneId, id, (w) => ({
        ...w,
        seam: [
          { yaw: round2(seam[0].yaw), pitch: round2(seam[0].pitch) },
          { yaw: round2(seam[1].yaw), pitch: round2(seam[1].pitch) },
        ],
        state: 'edited',
      })),
    }))
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

// dev/test hook: live store access from the browser console / automation
if (typeof window !== 'undefined') {
  ;(window as any).__pwpStore = useStore
}
