import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { EYE_HEIGHT_M, GROUND_Y, UNITS_PER_METER, aimToDir, dirToAim } from '../lib/coords'
import type { Wall } from '../lib/types'
import { useStore } from '../store'

type Drag =
  | { kind: 'corner'; end: 0 | 1; pointerId: number }
  | { kind: 'height'; pointerId: number }
  | { kind: 'move'; pointerId: number }
  | null

export function wallCorners(wall: Wall) {
  const [a, b] = wall.seam
  const da = aimToDir(a.yaw, a.pitch)
  const db = aimToDir(b.yaw, b.pitch)
  const b0 = new THREE.Vector3(da[0], da[1], da[2]).multiplyScalar(GROUND_Y / da[1])
  const b1 = new THREE.Vector3(db[0], db[1], db[2]).multiplyScalar(GROUND_Y / db[1])
  const h = wall.heightM * UNITS_PER_METER
  return { b0, b1, t0: b0.clone().setY(GROUND_Y + h), t1: b1.clone().setY(GROUND_Y + h), h }
}

const HANDLE_R = 0.72

/**
 * Screen-constant sized, camera-facing handle: the dot renders the same
 * pixel size at any distance (like Blender/SketchUp gizmos), with a slim
 * dark rim for contrast and an invisible larger hit zone for comfort.
 */
function Handle({
  position,
  color,
  onDown,
}: {
  position: THREE.Vector3
  color: string
  onDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const ref = useRef<THREE.Group>(null)
  const { camera } = useThree()
  const [hovered, setHovered] = useState(false)

  useFrame(() => {
    if (!ref.current) return
    const d = ref.current.position.distanceTo(camera.position)
    // constant screen size: world radius grows linearly with distance
    ref.current.scale.setScalar(Math.max(1.5, d * 0.03))
    ref.current.quaternion.copy(camera.quaternion) // billboard
  })

  return (
    <group ref={ref} position={position}>
      {/* generous invisible hit zone (~2.5× the visual dot) */}
      <mesh
        onPointerDown={onDown}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        renderOrder={7}
      >
        <circleGeometry args={[2.2, 24]} />
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* slim dark rim + dot */}
      <mesh renderOrder={8}>
        <ringGeometry args={[hovered ? 0.7 : HANDLE_R, hovered ? 0.95 : 1, 28]} />
        <meshBasicMaterial color="#101418" transparent opacity={0.85} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh renderOrder={8}>
        <circleGeometry args={[hovered ? 0.78 : HANDLE_R, 28]} />
        <meshBasicMaterial color={color} transparent opacity={hovered ? 1 : 0.92} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * Direct manipulation for the selected wall:
 *  - white dots on the floor seam: drag → the corner slides along the
 *    virtual floor (aim re-derived every frame) — stretch
 *  - amber dots on the top edge: drag up/down → wall height
 *  - blue dot at the center: drag → the whole wall slides on the floor
 * OrbitControls is disabled while a drag is live (setControls).
 */
export function WallEditHandles({
  wall,
  ndc,
  setControls,
}: {
  wall: Wall
  ndc: React.MutableRefObject<THREE.Vector2>
  setControls: (enabled: boolean) => void
}) {
  const { camera } = useThree()
  const setSeamAim = useStore((s) => s.setSeamAim)
  const setWallSeam = useStore((s) => s.setWallSeam)
  const setWallHeight = useStore((s) => s.setWallHeight)
  const drag = useRef<Drag>(null)
  const grabDist = useRef({ min: 0.5, max: 15 })
  const moveGrab = useRef(new THREE.Vector3())
  const moveStart = useRef({ b0: new THREE.Vector3(), b1: new THREE.Vector3() })
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y),
    [],
  )
  const hit = useMemo(() => new THREE.Vector3(), [])

  const { b0, b1, t0, t1, h } = useMemo(() => wallCorners(wall), [wall])
  const center = useMemo(
    () => b0.clone().add(b1).multiplyScalar(0.5).setY(GROUND_Y + h / 2),
    [b0, b1, h],
  )
  const normal = useMemo(() => {
    const right = b1.clone().sub(b0).normalize()
    const n = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0)).normalize()
    return n.dot(center) > 0 ? n.negate() : n
  }, [b0, b1, center])

  const outline = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([b0, b1, t1, t0])
    return g
  }, [b0, b1, t0, t1])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      raycaster.setFromCamera(ndc.current, camera)
      const ray = raycaster.ray
      if (d.kind === 'corner') {
        if (ray.intersectPlane(floorPlane, hit)) {
          // bound the corner to [40% .. 250%] of its distance when grabbed:
          // near the horizon the raw floor projection explodes to infinity
          const horiz = Math.hypot(hit.x, hit.z)
          const clamped = Math.min(grabDist.current.max, Math.max(grabDist.current.min, horiz))
          const k = clamped / (horiz || 1)
          setSeamAim(wall.id, d.end, dirToAim(hit.x * k, GROUND_Y, hit.z * k))
        }
      } else if (d.kind === 'height') {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center)
        if (ray.intersectPlane(plane, hit)) {
          const heightM = Math.min(6, Math.max(0.3, (hit.y - GROUND_Y) / UNITS_PER_METER))
          setWallHeight(wall.id, Math.round(heightM * 100) / 100)
        }
      } else if (d.kind === 'move') {
        if (ray.intersectPlane(floorPlane, hit)) {
          const delta = hit.clone().sub(moveGrab.current)
          const a0 = dirToAim(moveStart.current.b0.x + delta.x, GROUND_Y, moveStart.current.b0.z + delta.z)
          const a1 = dirToAim(moveStart.current.b1.x + delta.x, GROUND_Y, moveStart.current.b1.z + delta.z)
          setWallSeam(wall.id, [a0, a1])
        }
      }
    }
    const up = () => {
      // ANY pointerup ends the drag — simpler and impossible to get stuck
      if (drag.current) {
        drag.current = null
        setControls(true)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [wall, ndc, camera, floorPlane, normal, center, setSeamAim, setWallSeam, setWallHeight, setControls, hit])

  const start =
    (d: { kind: 'corner'; end: 0 | 1 } | { kind: 'height' } | { kind: 'move' }) =>
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      if (d.kind === 'corner') {
        // corner drag range is relative to where the corner sits now —
        // the seam's pitch encodes its floor distance: d = h / tan(|pitch|)
        const seamAim = d.end === 0 ? wall.seam[0] : wall.seam[1]
        const dist = Math.abs(EYE_HEIGHT_M / Math.tan((Math.abs(seamAim.pitch) * Math.PI) / 180))
        grabDist.current = { min: Math.max(0.5, dist * 0.4), max: dist * 2.5 }
      }
      if (d.kind === 'move') {
        // remember where on the floor the grab began
        raycaster.setFromCamera(ndc.current, camera)
        if (raycaster.ray.intersectPlane(floorPlane, hit)) {
          moveGrab.current.copy(hit)
          moveStart.current = { b0: b0.clone(), b1: b1.clone() }
          drag.current = { kind: 'move', pointerId: e.pointerId }
        }
      } else {
        drag.current = { ...d, pointerId: e.pointerId } as Drag
      }
      setControls(false)
    }

  return (
    <group>
      <lineLoop geometry={outline} renderOrder={6}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.55} depthTest={false} depthWrite={false} />
      </lineLoop>
      <Handle position={b0} color="#ffffff" onDown={start({ kind: 'corner', end: 0 })} />
      <Handle position={b1} color="#ffffff" onDown={start({ kind: 'corner', end: 1 })} />
      <Handle position={t0} color="#ffd166" onDown={start({ kind: 'height' })} />
      <Handle position={t1} color="#ffd166" onDown={start({ kind: 'height' })} />
      <Handle
        position={center.clone().addScaledVector(normal, 12)}
        color="#8fd0ff"
        onDown={start({ kind: 'move' })}
      />
    </group>
  )
}
