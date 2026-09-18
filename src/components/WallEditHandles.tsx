import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EYE_HEIGHT_M, GROUND_Y, UNITS_PER_METER, aimToDir, dirToAim } from '../lib/coords'
import type { Wall } from '../lib/types'
import { useStore } from '../store'

type DragKind = 'corner0' | 'corner1' | 'height' | 'move'

export function wallCorners(wall: Wall) {
  const [a, b] = wall.seam
  const da = aimToDir(a.yaw, a.pitch)
  const db = aimToDir(b.yaw, b.pitch)
  const b0 = new THREE.Vector3(da[0], da[1], da[2]).multiplyScalar(GROUND_Y / da[1])
  const b1 = new THREE.Vector3(db[0], db[1], db[2]).multiplyScalar(GROUND_Y / db[1])
  const h = wall.heightM * UNITS_PER_METER
  return { b0, b1, t0: b0.clone().setY(GROUND_Y + h), t1: b1.clone().setY(GROUND_Y + h), h }
}

/**
 * Direct manipulation for the selected wall — all pointer handling runs in
 * window listeners with our own ray-sphere hit tests (r3f event delivery is
 * bypassed on purpose: it depends on the render loop, which throttles when
 * the browser pane is occluded).
 *
 *  - white dots on the floor seam: drag → the corner slides along the
 *    virtual floor with grab-offset semantics (1:1 follow, no teleport)
 *  - amber dots on the top edge: drag up/down → wall height
 *  - blue dot at the center: drag → the whole wall slides on the floor
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
  const { camera, gl } = useThree()
  const setSeamAim = useStore((s) => s.setSeamAim)
  const setWallSeam = useStore((s) => s.setWallSeam)
  const setWallHeight = useStore((s) => s.setWallHeight)
  const dragKind = useRef<DragKind | null>(null)
  const dragPointer = useRef<number | null>(null)
  const grabOffset = useRef(new THREE.Vector3())
  const moveGrab = useRef(new THREE.Vector3())
  const moveStart = useRef({ b0: new THREE.Vector3(), b1: new THREE.Vector3() })
  const dragBounds = useRef({ min: 0.5, max: 20 })
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const [hoverIdx, setHoverIdx] = useState(-1)

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

  const handles = useMemo(
    () => [
      { kind: 'corner' as const, end: 0 as 0 | 1, pos: b0, color: '#ffffff' },
      { kind: 'corner' as const, end: 1 as 0 | 1, pos: b1, color: '#ffffff' },
      { kind: 'height' as const, pos: t0, color: '#ffd166' },
      { kind: 'height' as const, pos: t1, color: '#ffd166' },
      { kind: 'move' as const, pos: center.clone().addScaledVector(normal, 12), color: '#8fd0ff' },
    ],
    [b0, b1, t0, t1, center, normal],
  )

  /** screen-constant hit radius for a handle at world position p */
  const hitRadius = (p: THREE.Vector3) => {
    const d = p.distanceTo(camera.position)
    return Math.max(1.5, d * 0.032) * 2.2
  }

  /** which handle is under the pointer ray? (-1 = none) */
  const pick = () => {
    camera.updateMatrixWorld()
    raycaster.setFromCamera(ndc.current, camera)
    let best = -1
    let bestT = Infinity
    handles.forEach((hd, i) => {
      const toC = hd.pos.clone().sub(raycaster.ray.origin)
      const t = toC.dot(raycaster.ray.direction)
      if (t <= 0) return
      const closest = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t)
      if (closest.distanceTo(hd.pos) <= hitRadius(hd.pos) && t < bestT) {
        bestT = t
        best = i
      }
    })
    return best
  }

  useEffect(() => {
    const dom = gl.domElement

    const onDown = (e: PointerEvent) => {
      if (e.target !== dom) return
      const r = dom.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
      const idx = pick()
      if (idx < 0) return
      const hd = handles[idx]
      if (hd.kind === 'corner') {
        // grab offset: the corner stays glued to the mouse point
        raycaster.setFromCamera(ndc.current, camera)
        if (raycaster.ray.intersectPlane(floorPlane, hit)) {
          grabOffset.current.copy(hd.pos).sub(hit)
        } else {
          grabOffset.current.set(0, 0, 0)
        }
        const seamAim = wall.seam[hd.end]
        const dist = Math.abs(EYE_HEIGHT_M / Math.tan((Math.abs(seamAim.pitch) * Math.PI) / 180))
        dragBounds.current = { min: Math.max(0.5, dist * 0.4), max: dist * 2.5 }
      }
      if (hd.kind === 'move') {
        raycaster.setFromCamera(ndc.current, camera)
        if (raycaster.ray.intersectPlane(floorPlane, hit)) {
          moveGrab.current.copy(hit)
          moveStart.current = { b0: b0.clone(), b1: b1.clone() }
        }
      }
      dragKind.current =
        hd.kind === 'corner' ? (hd.end === 0 ? 'corner0' : 'corner1') : hd.kind
      dragPointer.current = e.pointerId
      setControls(false)
      e.preventDefault()
    }

    const onMove = (e: PointerEvent) => {
      if (!dragKind.current) {
        // hover: pick + cursor feedback
        const r = dom.getBoundingClientRect()
        ndc.current.set(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        )
        const idx = pick()
        setHoverIdx(idx)
        const next = idx >= 0 ? 'grab' : ''
        if (document.body.style.cursor !== next) document.body.style.cursor = next
        return
      }
      if (e.pointerId !== dragPointer.current) return
      const r = dom.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc.current, camera)
      const ray = raycaster.ray
      const kind = dragKind.current
      if (kind === 'corner0' || kind === 'corner1') {
        if (ray.intersectPlane(floorPlane, hit)) {
          const target = hit.clone().add(grabOffset.current)
          const horiz = Math.hypot(target.x, target.z)
          const clamped = Math.min(dragBounds.current.max, Math.max(dragBounds.current.min, horiz))
          const k = clamped / (horiz || 1)
          setSeamAim(wall.id, kind === 'corner0' ? 0 : 1, dirToAim(target.x * k, GROUND_Y, target.z * k))
        }
      } else if (kind === 'height') {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center)
        if (ray.intersectPlane(plane, hit)) {
          const heightM = Math.min(6, Math.max(0.3, (hit.y - GROUND_Y) / UNITS_PER_METER))
          setWallHeight(wall.id, Math.round(heightM * 100) / 100)
        }
      } else if (kind === 'move') {
        if (ray.intersectPlane(floorPlane, hit)) {
          const delta = hit.clone().sub(moveGrab.current)
          const a0 = clampFloor(
            new THREE.Vector3(moveStart.current.b0.x + delta.x, GROUND_Y, moveStart.current.b0.z + delta.z),
          )
          const a1 = clampFloor(
            new THREE.Vector3(moveStart.current.b1.x + delta.x, GROUND_Y, moveStart.current.b1.z + delta.z),
          )
          setWallSeam(wall.id, [dirToAim(a0.x, GROUND_Y, a0.z), dirToAim(a1.x, GROUND_Y, a1.z)])
        }
      }
    }

    const onUp = () => {
      if (dragKind.current) {
        dragKind.current = null
        setControls(true)
      }
    }

    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [wall, ndc, camera, gl, handles, floorPlane, normal, center, setSeamAim, setWallSeam, setWallHeight, setControls])

  function clampFloor(p: THREE.Vector3) {
    const horiz = Math.hypot(p.x, p.z)
    const clamped = Math.min(20, Math.max(0.4, horiz))
    return p.multiplyScalar(clamped / (horiz || 1))
  }

  // the five dots (visual only — pointer logic lives in the window listeners)
  const dots: { pos: THREE.Vector3; color: string }[] = [
    { pos: b0, color: '#ffffff' },
    { pos: b1, color: '#ffffff' },
    { pos: t0, color: '#ffd166' },
    { pos: t1, color: '#ffd166' },
    { pos: center.clone().addScaledVector(normal, 12), color: '#8fd0ff' },
  ]

  return (
    <group>
      <lineLoop geometry={outline} renderOrder={6}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.55} depthTest={false} depthWrite={false} />
      </lineLoop>
      {dots.map((d, i) => (
        <HandleDot key={i} position={d.pos} color={d.color} hovered={hoverIdx === i} />
      ))}
    </group>
  )
}

function HandleDot({ position, color, hovered }: { position: THREE.Vector3; color: string; hovered: boolean }) {
  const ref = useRef<THREE.Group>(null)
  const { camera } = useThree()
  useFrame(() => {
    if (!ref.current) return
    const d = ref.current.position.distanceTo(camera.position)
    ref.current.scale.setScalar(Math.max(1.5, d * 0.03))
    ref.current.quaternion.copy(camera.quaternion)
  })
  return (
    <group ref={ref} position={position}>
      <mesh renderOrder={8}>
        <ringGeometry args={[hovered ? 0.7 : 0.72, hovered ? 0.95 : 1, 28]} />
        <meshBasicMaterial color="#101418" transparent opacity={0.85} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh renderOrder={8}>
        <circleGeometry args={[hovered ? 0.78 : 0.72, 28]} />
        <meshBasicMaterial color={color} transparent opacity={hovered ? 1 : 0.92} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
