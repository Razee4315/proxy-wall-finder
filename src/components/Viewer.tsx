import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GROUND_Y, UNITS_PER_METER, aimToDir } from '../lib/coords'
import type { Scene, Wall } from '../lib/types'
import { WallEditHandles } from './WallEditHandles'

const COLORS: Record<string, string> = {
  auto: '#4ade80',
  review: '#f5a623',
  accepted: '#4ade80',
  edited: '#3aa0ff',
  rejected: '#ef4444',
}
const FLOOR_RING_COLOR = '#8fd0ff'

export type Probe = { surface: 'floor' | 'wall' | 'none'; wallId: string; wallState: string; distM: number }

/** One compiled wall quad: a vertical rectangle on the plane n·x = dp,
 *  spanning center ± right·halfW horizontally, floor..floor+height vertically.
 *  `normal` points back at the capture point (origin). */
function compileQuad(wall: Wall) {
  const [a, b] = wall.seam
  const da = aimToDir(a.yaw, a.pitch)
  const db = aimToDir(b.yaw, b.pitch)
  if (da[1] >= -1e-6 || db[1] >= -1e-6) return null
  const b0 = new THREE.Vector3(da[0], da[1], da[2]).multiplyScalar(GROUND_Y / da[1])
  const b1 = new THREE.Vector3(db[0], db[1], db[2]).multiplyScalar(GROUND_Y / db[1])
  const center = b0.clone().add(b1).multiplyScalar(0.5)
  const right = b1.clone().sub(b0)
  const halfW = right.length() / 2
  if (halfW < 1e-4) return null
  right.divideScalar(halfW * 2)
  const normal = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize()
  if (normal.dot(center) > 0) normal.negate() // point back at the capture point
  const dp = normal.dot(center)
  const halfH = (wall.heightM * UNITS_PER_METER) / 2
  return { normal, dp, center, right, halfW, halfH, wall }
}

/** The tour's ground cursor, ported for verification: raycast {wall quads,
 *  floor plane}, nearest wins; the ring lies flat on the floor and stands
 *  up on walls, tinted by the wall's state. Purely visual. */
function CursorRing({
  quads,
  ndc,
  onProbe,
}: {
  quads: ReturnType<typeof compileQuad>[]
  ndc: React.MutableRefObject<THREE.Vector2>
  onProbe: (p: Probe) => void
}) {
  const { camera, gl } = useThree()
  const group = useRef<THREE.Group>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const wallQuat = useRef(new THREE.Quaternion())
  const lastProbeKey = useRef("")

  useFrame(() => {
    if (!group.current || !ringMat.current) return
    let probe: Probe = { surface: 'none', wallId: '', wallState: '', distM: 0 }
    let target: THREE.Vector3 | null = null
    let quat: THREE.Quaternion | null = null
    let color = FLOOR_RING_COLOR
    let opacity = 0

    const inside = ndc.current.x >= -1 && ndc.current.x <= 1 && ndc.current.y >= -1 && ndc.current.y <= 1
    if (inside) {
      ray.setFromCamera(ndc.current, camera)
      const o = ray.ray.origin
      const dir = ray.ray.direction

      // nearest wall quad under the pointer
      let bestT = Infinity
      let best: (typeof quads)[number] = null
      for (const q of quads) {
        if (!q) continue
        const denom = dir.dot(q.normal)
        if (Math.abs(denom) < 1e-6) continue
        const t = (q.dp - o.dot(q.normal)) / denom
        if (t <= 0.1 || t >= bestT) continue
        const p = o.clone().addScaledVector(dir, t)
        const local = p.clone().sub(q.center)
        if (Math.abs(local.dot(q.right)) > q.halfW) continue
        if (p.y < GROUND_Y || p.y > GROUND_Y + q.halfH * 2) continue
        bestT = t
        best = q
      }
      // floor plane (camera sits at origin, floor below)
      let floorT = Infinity
      if (dir.y < -1e-4) floorT = GROUND_Y / dir.y

      if (best && bestT < floorT) {
        const p = o.clone().addScaledVector(dir, bestT)
        target = p
        wallQuat.current.setFromUnitVectors(up, best.normal)
        quat = wallQuat.current
        color = COLORS[best.wall.state] ?? '#fff'
        opacity = 0.7
        probe = { surface: 'wall', wallId: best.wall.id, wallState: best.wall.state, distM: bestT / UNITS_PER_METER }
      } else if (Number.isFinite(floorT) && (floorT / UNITS_PER_METER) <= 25) {
        // the tour hides the ring in the near-horizon band where floor rays
        // stretch to the skyline clamp — same contract here: ≤ 25 m or nothing
        target = o.clone().addScaledVector(dir, floorT)
        quat = null // flat on the floor
        color = FLOOR_RING_COLOR
        opacity = 0.55
        probe = { surface: 'floor', wallId: '', wallState: '', distM: floorT / UNITS_PER_METER }
      }
    }

    const g = group.current
    if (target) {
      if (g.position.distanceTo(target) > 220) g.position.copy(target)
      else g.position.lerp(target, 0.35)
      if (quat) g.quaternion.slerp(quat, 0.35)
      else g.quaternion.slerp(new THREE.Quaternion(), 0.35)
      const dist = g.position.length()
      g.scale.setScalar(Math.min(40, Math.max(4, dist * 0.08)))
    }
    ringMat.current.color.set(color)
    ringMat.current.opacity += (opacity - ringMat.current.opacity) * 0.3
    g.visible = ringMat.current.opacity > 0.02

    // only poke React when the reading actually changes
    const key = `${probe.surface}|${probe.wallId}|${probe.distM.toFixed(1)}`
    if (key !== lastProbeKey.current) {
      lastProbeKey.current = key
      onProbe(probe)
    }

    // test/debug hook: live raycast state + world→screen projection
    const size = new THREE.Vector2()
    gl.getSize(size)
    const v = new THREE.Vector3()
    ;(window as any).__ring = {
      hovering: true,
      quads: quads.length,
      surface: probe.surface,
      distM: probe.distM.toFixed(1),
      project: (x: number, y: number, z: number) => {
        camera.updateMatrixWorld()
        v.set(x, y, z).project(camera)
        return [((v.x + 1) / 2) * size.x, ((1 - v.y) / 2) * size.y, v.z]
      },
    }
  })

  return (
    <group ref={group} renderOrder={4}>
      <mesh rotation-x={-Math.PI / 2} renderOrder={4}>
        <ringGeometry args={[0.74, 1, 48]} />
        <meshBasicMaterial ref={ringMat} color={FLOOR_RING_COLOR} transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function WallMesh({ wall, selected, onSelect }: { wall: Wall; selected: boolean; onSelect: () => void }) {
  const geometry = useMemo(() => {
    const [a, b] = wall.seam
    const da = aimToDir(a.yaw, a.pitch)
    const db = aimToDir(b.yaw, b.pitch)
    if (da[1] >= -1e-6 || db[1] >= -1e-6) return new THREE.BufferGeometry()
    const ta = GROUND_Y / da[1]
    const tb = GROUND_Y / db[1]
    const b0 = new THREE.Vector3(da[0] * ta, GROUND_Y, da[2] * ta)
    const b1 = new THREE.Vector3(db[0] * tb, GROUND_Y, db[2] * tb)
    const h = wall.heightM * UNITS_PER_METER
    const t0 = b0.clone().setY(GROUND_Y + h)
    const t1 = b1.clone().setY(GROUND_Y + h)
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, t1.x, t1.y, t1.z,
          b0.x, b0.y, b0.z, t1.x, t1.y, t1.z, t0.x, t0.y, t0.z,
        ]),
        3,
      ),
    )
    return g
  }, [wall])
  return (
    <mesh geometry={geometry} onClick={(e) => { e.stopPropagation(); onSelect() }} renderOrder={2}>
      <meshBasicMaterial
        color={COLORS[wall.state] ?? '#fff'}
        transparent
        opacity={selected ? 0.45 : 0.22}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function Viewer({
  scene,
  selectedWallId,
  onSelectWall,
}: {
  scene: Scene | null
  selectedWallId: string | null
  onSelectWall: (id: string | null) => void
}) {
  const [probe, setProbe] = useState<Probe>({ surface: 'none', wallId: '', wallState: '', distM: 0 })
  const ndc = useRef(new THREE.Vector2(10, 10))
  const [controlsEnabled, setControlsEnabled] = useState(true)
  const quads = useMemo(() => (scene ? scene.walls.map(compileQuad) : []), [scene])

  // window-level pointer tracking — NDC mapped through the canvas rect, so
  // the ring and the drag handles follow the mouse no matter which element
  // the browser lands events on
  useEffect(() => {
    const canvas = document.querySelector('.viewer canvas')
    const track = (e: PointerEvent) => {
      if (!canvas) return
      const r = canvas.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
    }
    window.addEventListener('pointermove', track)
    return () => window.removeEventListener('pointermove', track)
  }, [])

  // deselect: click on empty space (handled by onPointerMissed) or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelectWall(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelectWall])

  const selectedWall = scene?.walls.find((w) => w.id === selectedWallId) ?? null

  if (!scene?.imageUrl) {
    return <div className="placeholder">Drop equirect panoramas here, then .npz depth</div>
  }
  return (
    <>
      <Canvas
        dpr={1}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 70, position: [0, 0, 0.01], near: 0.1, far: 2000 }}
        onPointerMissed={() => onSelectWall(null)}
      >
        <Pano url={scene.imageUrl} />
        <gridHelper args={[400, 40, '#3a5', '#1a3']} position={[0, GROUND_Y + 0.05, 0]} />
        {scene.walls.map((wall) => (
          <WallMesh
            key={wall.id}
            wall={wall}
            selected={wall.id === selectedWallId}
            onSelect={() => onSelectWall(wall.id)}
          />
        ))}
        {selectedWall && (
          <WallEditHandles wall={selectedWall} ndc={ndc} setControls={setControlsEnabled} />
        )}
        <CursorRing quads={quads} ndc={ndc} onProbe={setProbe} />
        <OrbitControls
          enabled={controlsEnabled}
          enablePan={false}
          target={[0, 0, 0]}
          rotateSpeed={-0.35}
          enableDamping
          dampingFactor={0.08}
          zoomSpeed={0.6}
        />
      </Canvas>
      <div className="probe-hud" data-surface={probe.surface}>
        {probe.surface === 'floor' && (
          <>● FLOOR — {probe.distM.toFixed(1)} m (clicks walk on the floor)</>
        )}
        {probe.surface === 'wall' && (
          <>
            <span style={{ color: COLORS[probe.wallState] ?? '#fff' }}>● {probe.wallId.toUpperCase()}</span>
            {' — '}
            {probe.wallState.toUpperCase()} · {probe.distM.toFixed(1)} m (ring rides the wall)
          </>
        )}
      </div>
    </>
  )
}

function Pano({ url }: { url: string }) {
  const map = useMemo(() => {
    const t = new THREE.TextureLoader().load(url)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [url])
  return (
    <mesh scale={[-1, 1, 1]} rotation={[0, -Math.PI / 2, 0]}>
      <sphereGeometry args={[500, 64, 32]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} />
    </mesh>
  )
}
