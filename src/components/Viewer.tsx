import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { GROUND_Y, UNITS_PER_METER, aimToDir } from '../lib/coords'
import type { Scene, Wall } from '../lib/types'

const COLORS: Record<string, string> = {
  auto: '#4ade80',
  review: '#f5a623',
  accepted: '#4ade80',
  edited: '#3aa0ff',
  rejected: '#ef4444',
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
  if (!scene?.imageUrl) {
    return <div className="placeholder">Drop equirect panoramas here, then .npz depth</div>
  }
  return (
    <Canvas camera={{ fov: 70, position: [0, 0, 0.01], near: 0.1, far: 2000 }}>
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
      <OrbitControls enablePan={false} target={[0, 0, 0]} rotateSpeed={-0.35} />
    </Canvas>
  )
}
