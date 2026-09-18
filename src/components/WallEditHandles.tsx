import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { GROUND_Y, UNITS_PER_METER, aimToDir, dirToAim } from '../lib/coords'
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

const HANDLE_R = 7 // ≈ 17 cm at tour scale — chunky enough to grab

/**
 * Direct manipulation for the selected wall:
 *  - white corner spheres on the floor seam: drag → the corner slides along
 *    the virtual floor (aim re-derived from the new floor point) — stretch
 *  - amber handles on the top edge: drag up/down → wall height
 *  - blue handle at the center: drag → the whole wall slides on the floor
 * OrbitControls must be disabled while a drag is live (setControls).
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

  // outline of the quad, updated with the wall
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
          setSeamAim(wall.id, d.end, dirToAim(hit.x, GROUND_Y, hit.z))
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
    const up = (e: PointerEvent) => {
      // only our own pointer's up ends the drag — stray cancels from
      // OrbitControls (fired when controls get disabled mid-drag) must not
      if (drag.current && e.pointerId === drag.current.pointerId) {
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

  const hover = (on: boolean) => () => {
    document.body.style.cursor = on ? 'grab' : ''
    // while the pointer is on a handle the camera must not orbit — grabbing
    // a corner and rotating the view at the same time is unusable
    setControls(on)
  }

  const sphere = (pos: THREE.Vector3, color: string, onDown: (e: ThreeEvent<PointerEvent>) => void, key: string) => (
    <mesh
      key={key}
      position={pos}
      onPointerDown={onDown}
      onPointerOver={hover(true)}
      onPointerOut={hover(false)}
      renderOrder={6}
    >
      <sphereGeometry args={[HANDLE_R, 16, 12]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} depthWrite={false} />
    </mesh>
  )

  return (
    <group>
      <lineLoop geometry={outline} renderOrder={6}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} depthWrite={false} />
      </lineLoop>
      {sphere(b0, '#ffffff', start({ kind: 'corner', end: 0 }), 'c0')}
      {sphere(b1, '#ffffff', start({ kind: 'corner', end: 1 }), 'c1')}
      {sphere(t0, '#ffd166', start({ kind: 'height' }), 'h0')}
      {sphere(t1, '#ffd166', start({ kind: 'height' }), 'h1')}
      {sphere(center.clone().addScaledVector(normal, 14), '#8fd0ff', start({ kind: 'move' }), 'm')}
    </group>
  )
}
