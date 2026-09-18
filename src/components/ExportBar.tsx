import { buildSessionJson, formatAllProxy, formatSceneProxy } from '../lib/export'
import type { Scene } from '../lib/types'

export function ExportBar({
  scenes,
  activeSceneId,
  status,
}: {
  scenes: Scene[]
  activeSceneId: string | null
  status: string
}) {
  const active = scenes.find((s) => s.id === activeSceneId) ?? null
  async function copy(text: string, msg: string) {
    await navigator.clipboard.writeText(text)
    alert(msg)
  }
  function download(name: string, text: string) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    a.download = name
    a.click()
  }
  return (
    <div className="export-inner">
      <span className="muted status">{status}</span>
      <div className="actions">
        <button disabled={!active} onClick={() => active && void copy(formatSceneProxy(active), 'Copied scene proxy')}>
          Copy scene
        </button>
        <button disabled={!scenes.length} onClick={() => void copy(formatAllProxy(scenes), 'Copied all')}>
          Copy all
        </button>
        <button
          disabled={!scenes.length}
          onClick={() => download('proxy-walls-session.json', buildSessionJson(scenes))}
        >
          Download JSON
        </button>
      </div>
    </div>
  )
}
