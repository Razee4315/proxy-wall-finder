import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GROUND_Y, UNITS_PER_METER, aimToDir, dirToAim } from '../lib/coords'
import type { Wall } from '../lib/types'
import { useStore } from '../store'

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
 * Direct manipulation for the selected wall. All pointer handling runs in
 * window listeners with our own math (r3f event delivery is bypassed on
 * purpose — it depends on the render loop, which throttles when the browser
 * pane is occluded).
 *
 * Interaction model (matches how walls work):
 *  - white dots (floor corners): drag → the corner slides ALONG THE WALL'S
 *    BASE LINE — stretch/shorten the wall. The other corner stays put.
 *  - amber dots (top corners): drag up/down → wall height
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
  const setWallHeight = useStore((s) => s.setWallHeight)
  const dragKind = useRef<'corner0' | 'corner1' | 'height' | null>(null)
  const dragPointer = useRef<number | null>(null)
  const lineOrigin = useRef(new THREE.Vector3())
  const lineDir = useRef(new THREE.Vector3())
  const raycaster = useMemo(() => new THREE.Raycaster(), [])

  const { b0, b1, t0, t1 } = useMemo(() => wallCorners(wall), [wall])

  const outline = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([b0, b1, t1, t0])
    return g
  }, [b0, b1, t0, t1])

  /** screen-constant hit radius (world units) for a handle at position p */
  const hitRadius = (p: THREE.Vector3) => Math.max(1.5, p.distanceTo(camera.position) * 0.032) * 2.2

  /** pick the handle under the current ndc ray (-1 = none) */
  const pick = () => {
    camera.updateMatrixWorld()
    raycaster.setFromCamera(ndc.current, camera)
    let best = -1
    let bestT = Infinity
    const candidates = [
      { i: 0, p: b0 },
      { i: 1, p: b1 },
      { i: 2, p: t0 },
      { i: 3, p: t1 },
    ]
    for (const { i, p } of candidates) {
      const toC = p.clone().sub(raycaster.ray.origin)
      const t = toC.dot(raycaster.ray.direction)
      if (t <= 0) continue
      const closest = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t)
      if (closest.distanceTo(p) <= hitRadius(p) && t < bestT) {
        bestT = t
        best = i
      }
    }
    return best
  }

  useEffect(() => {
    const dom = gl.domElement

    const setNdc = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect()
      ndc.current.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      )
    }

    const onDown = (e: PointerEvent) => {
      if (e.target !== dom) return
      setNdc(e)
      const idx = pick()
      if (idx < 0) return
      if (idx === 0) dragKind.current = 'corner0'
      else if (idx === 1) dragKind.current = 'corner1'
      else dragKind.current = 'height'
      dragPointer.current = e.pointerId
      if (idx <= 1) {
        // freeze the wall's base line at grab: the dragged corner slides
        // along this line, the other corner stays fixed
        const self = idx === 0 ? b0 : b1
        const other = idx === 0 ? b1 : b0
        lineDir.current = other.clone().sub(self).setY(0).normalize()
        lineOrigin.current = other.clone()
      }
      setControls(false)
      e.preventDefault()
    }

    const onMove = (e: PointerEvent) => {
      if (!dragKind.current) {
        setNdc(e)
        const idx = pick()
        const next = idx >= 0 ? 'grab' : ''
        if (document.body.style.cursor !== next) document.body.style.cursor = next
        return
      }
      if (e.pointerId !== dragPointer.current) return
      setNdc(e)
      camera.updateMatrixWorld()
      raycaster.setFromCamera(ndc.current, camera)

      if (dragKind.current === 'corner0' || dragKind.current === 'corner1') {
        // slide the dragged corner along the wall's base line: intersect the
        // pointer ray with the wall's vertical plane, then project onto the
        // base line (clamped 10 cm .. 20 m from the fixed corner)
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(-lineDir.current.z, 0, lineDir.current.x).normalize(),
          lineOrigin.current,
        )
        const hp = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(plane, hp)) {
          let t = hp.clone().sub(lineOrigin.current).dot(lineDir.current)
          t = Math.min(800, Math.max(4, t))
          const p = lineOrigin.current.clone().addScaledVector(lineDir.current, t)
          const aim = dirToAim(p.x, GROUND_Y, p.z)
          setSeamAim(
            wall.id,
            dragKind.current === 'corner0' ? 0 : 1,
            { yaw: Math.round(aim.yaw * 100) / 100, pitch: Math.round(aim.pitch * 100) / 100 },
          )
        }
      } else {
        // height: intersect the pointer ray with the wall's vertical plane
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(-lineDir.current.z, 0, lineDir.current.x).normalize(),
          lineOrigin.current,
        )
        const hp = new THREE.Vector3()
        if (raycaster.ray.intersectPlane(plane, hp)) {
          const heightM = Math.min(6, Math.max(0.3, (hp.y - GROUND_Y) / UNITS_PER_METER))
          setWallHeight(wall.id, Math.round(heightM * 100) / 100)
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
  }, [wall, ndc, camera, gl, b0, b1, t0, t1, outline, setSeamAim, setWallHeight, setControls])

  const dots = [
    { pos: b0, color: '#ffffff' },
    { pos: b1, color: '#ffffff' },
    { pos: t0, color: '#ffd166' },
    { pos: t1, color: '#ffd166' },
  ]

  return (
    <group>
      <lineLoop geometry={outline} renderOrder={6}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.55} depthTest={false} depthWrite={false} />
      </lineLoop>
      {dots.map((d, i) => (
        <HandleDot key={i} position={d.pos} color={d.color} />
      ))}
    </group>
  )
}

function HandleDot({ position, color }: { position: THREE.Vector3; color: string }) {
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
        <ringGeometry args={[0.72, 1, 28]} />
        <meshBasicMaterial color="#101418" transparent opacity={0.85} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh renderOrder={8}>
        <circleGeometry args={[0.72, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.92} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
