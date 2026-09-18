import type { Scene, WallState } from '../lib/types'

const STATES: WallState[] = ['auto', 'review', 'accepted', 'edited', 'rejected']

export function Sidebar(props: {
  scenes: Scene[]
  activeSceneId: string | null
  selectedWallId: string | null
  onSelectScene: (id: string) => void
  onSelectWall: (id: string) => void
  onSetState: (id: string, state: WallState) => void
  onNudge: (id: string, end: 0 | 1, dYaw: number) => void
  onHeight: (id: string, heightM: number) => void
  onRemoveScene: (id: string) => void
}) {
  const scene = props.scenes.find((s) => s.id === props.activeSceneId) ?? null
  const wall = scene?.walls.find((w) => w.id === props.selectedWallId) ?? null
  return (
    <div className="sidebar-inner">
      <section>
        <h3>Scenes</h3>
        <ul className="list">
          {props.scenes.map((s) => (
            <li key={s.id}>
              <button className={s.id === props.activeSceneId ? 'active' : ''} onClick={() => props.onSelectScene(s.id)}>
                {s.id} <span className="muted">{s.walls.length}w</span>
              </button>
              <button className="ghost" onClick={() => props.onRemoveScene(s.id)}>×</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Walls</h3>
        <ul className="list">
          {scene?.walls.map((w) => (
            <li key={w.id}>
              <button className={w.id === props.selectedWallId ? 'active' : ''} onClick={() => props.onSelectWall(w.id)}>
                <i className={`dot state-${w.state}`} />
                {w.id} · {w.state} · {Math.round(w.confidence * 100)}%
              </button>
            </li>
          ))}
        </ul>
        {scene && scene.walls.length === 0 && <p className="muted">Load a .npz to extract walls</p>}
      </section>
      {wall && (
        <section>
          <h3>Edit {wall.id}</h3>
          <label>
            State
            <select value={wall.state} onChange={(e) => props.onSetState(wall.id, e.target.value as WallState)}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Height (m)
            <input type="number" step="0.1" min={0.5} max={6} value={wall.heightM}
              onChange={(e) => props.onHeight(wall.id, Number(e.target.value))} />
          </label>
          <div className="nudge">
            <span>A</span>
            <button onClick={() => props.onNudge(wall.id, 0, -1)}>-1°</button>
            <button onClick={() => props.onNudge(wall.id, 0, -0.1)}>-0.1</button>
            <button onClick={() => props.onNudge(wall.id, 0, 0.1)}>+0.1</button>
            <button onClick={() => props.onNudge(wall.id, 0, 1)}>+1°</button>
          </div>
          <div className="nudge">
            <span>B</span>
            <button onClick={() => props.onNudge(wall.id, 1, -1)}>-1°</button>
            <button onClick={() => props.onNudge(wall.id, 1, -0.1)}>-0.1</button>
            <button onClick={() => props.onNudge(wall.id, 1, 0.1)}>+0.1</button>
            <button onClick={() => props.onNudge(wall.id, 1, 1)}>+1°</button>
          </div>
        </section>
      )}
    </div>
  )
}
