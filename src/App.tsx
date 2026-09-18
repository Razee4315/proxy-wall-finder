import { useEffect, useRef } from 'react'
import { ExportBar } from './components/ExportBar'
import { Sidebar } from './components/Sidebar'
import { Viewer } from './components/Viewer'
import { useStore } from './store'

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const store = useStore()
  useEffect(() => { store.hydrate() }, [store.hydrate])
  const active = store.scenes.find((s) => s.id === store.activeSceneId) ?? null

  async function onFiles(list: FileList | null) {
    if (!list) return
    const files = [...list]
    for (const f of files.filter((x) => /\.(jpe?g|png|webp)$/i.test(x.name))) {
      await store.addPanorama(f)
    }
    const npz = files.find((x) => /\.npz$/i.test(x.name))
    if (npz) {
      const base = npz.name.replace(/\.npz$/i, '')
      const json = files.find((x) => x.name.replace(/\.json$/i, '') === base)
      await store.loadDepthForActive(npz, json)
    }
  }

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}>
      <header className="topbar">
        <strong style={{ fontFamily: 'var(--font-logo)' }}>Proxy Wall Finder</strong>
        <span className="muted mono" style={{ fontSize: 12 }}>360 wall calibrator for NEIC-Tour</span>
        <button style={{ marginLeft: 'auto' }} onClick={() => inputRef.current?.click()}>Open files</button>
        <input ref={inputRef} hidden type="file" multiple accept=".jpg,.jpeg,.png,.webp,.npz,.json" onChange={(e) => void onFiles(e.target.files)} />
      </header>
      <main className="viewer">
        <Viewer scene={active} selectedWallId={store.selectedWallId} onSelectWall={store.selectWall} />
      </main>
      <aside className="sidebar">
        <Sidebar
          scenes={store.scenes}
          activeSceneId={store.activeSceneId}
          selectedWallId={store.selectedWallId}
          onSelectScene={store.setActiveScene}
          onSelectWall={store.selectWall}
          onSetState={store.setWallState}
          onNudge={store.nudgeSeam}
          onHeight={store.setWallHeight}
          onRemoveScene={store.removeScene}
        />
      </aside>
      <footer className="exportbar">
        <ExportBar scenes={store.scenes} activeSceneId={store.activeSceneId} status={store.status} />
      </footer>
    </div>
  )
}
