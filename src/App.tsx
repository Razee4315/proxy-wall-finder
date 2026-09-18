/**
 * Proxy Wall Finder — scaffold shell (M0 in docs/ROADMAP.md).
 * Layout: top bar / 3D viewer / wall sidebar / export bar.
 * The viewer and pipeline land in M1-M4; this shell only proves the
 * grid, tokens and drop-zone wiring.
 */
export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <strong style={{ fontFamily: 'var(--font-logo)' }}>Proxy Wall Finder</strong>
        <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          360 wall calibrator — proxy geometry for NEIC-Tour
        </span>
      </header>
      <main className="viewer">
        <div className="placeholder">
          Drop equirectangular panoramas here (M0 scaffold — viewer lands in M1).
          <br />
          Docs: docs/PRD.md · docs/TECHNICAL-DESIGN.md · docs/ROADMAP.md
        </div>
      </main>
      <aside className="sidebar">
        <div className="placeholder">Wall list (M3)</div>
      </aside>
      <footer className="exportbar">
        <div className="placeholder" style={{ height: 'auto' }}>Export bar (M5)</div>
      </footer>
    </div>
  )
}
