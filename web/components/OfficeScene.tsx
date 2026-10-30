// @ts-nocheck — R3F JSX types are complex; works at runtime
'use client'

/**
 * Oficina 3D de Back Office. Usa la oficina horneada (Office.glb), los avatares voxel y la navegación
 * de la oficina de un proyecto interno anterior. Cada personaje es un agente del equipo (o una sesión de Claude):
 *   working → escribiendo en su escritorio       waiting → "mantenimiento": espera a una persona
 *   idle    → sentado, respirando                error   → pulso rojo
 *   offline → se va al lounge a descansar        sin sesión → vuelve a su escritorio cuando hay actividad
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import ParametricOffice from './office/ParametricOffice'
import VoxelAvatar from './office/VoxelAvatar'
import { FACE_GLB_COUNT, faceModelUrl } from './office/officeLayout'
import { createOfficeNavGrid, setActiveNavGrid } from './office/officeNavGrid'
import { generateOffice, type Interaction, type OfficeLayout } from '@/lib/office/generate'
import { useTheme } from '@/lib/theme'
import Daylight, { useDaylight } from './office/Daylight'
import type { Seat as TeamSeat } from '@/lib/team'
import type { Task, TaskStatus } from '@/lib/types'

for (let i = 0; i < FACE_GLB_COUNT; i++) useGLTF.preload(faceModelUrl(i))

const ISO_DIST = 60

// Cara y paleta por agente, elegidas para que su camisa coincida con el color de la marca.
const FACE_BY_ID: Record<string, number> = { cmo: 17, researcher: 4, creative: 6, analyst: 7 }
const FACE_FALLBACK = [0, 2, 9, 13, 16, 19]

const STATUS_MAP = { working: 'BUSY', waiting: 'MAINTENANCE', idle: 'IDLE', error: 'ERROR', offline: 'OFFLINE' }

// Pared del fondo (norte): tablero de corcho con una nota adhesiva por tarea, de color según su estado.
const NOTE_COLOR: Record<TaskStatus, string> = { backlog: '#E6E6E6', cancelled: '#D0D0D0', todo: '#FFE98A', doing: '#BFE3FF', blocked: '#FFC4C4', review: '#FFD0A0', done: '#C9F2C7' }
const NOTE_INK: Record<TaskStatus, string> = { backlog: '#555555', cancelled: '#777777', todo: '#7A5B00', doing: '#1B5E94', blocked: '#9B1C1C', review: '#9A4B00', done: '#1F7A32' }

function Note({ task, n, x, y, tilt, selected, onSelect }: any) {
  const [hover, setHover] = useState(false)
  const title = task.title.length > 34 ? task.title.slice(0, 33) + '…' : task.title
  return (
    <group position={[x, y, 0.045]} rotation={[0, 0, tilt]} scale={hover || selected ? 1.07 : 1}
      onClick={(e: any) => { e.stopPropagation(); onSelect(task.id) }}
      onPointerOver={(e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}>
      {selected && (
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[1.14, 0.76]} />
          <meshBasicMaterial color="#2D6BFF" />
        </mesh>
      )}
      <mesh>
        <planeGeometry args={[1.05, 0.68]} />
        <meshLambertMaterial color={NOTE_COLOR[task.status as TaskStatus]} />
      </mesh>
      <mesh position={[0, 0.3, 0.012]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshLambertMaterial color="#D9342B" />
      </mesh>
      <Text position={[-0.46, 0.2, 0.01]} fontSize={0.14} anchorX="left" anchorY="middle" font="/fonts/inter-black.ttf" color={NOTE_INK[task.status as TaskStatus]}>
        {`#${n}`}
      </Text>
      <Text position={[-0.46, -0.04, 0.01]} fontSize={0.085} maxWidth={0.92} lineHeight={1.15} anchorX="left" anchorY="top" font="/fonts/inter-black.ttf" color="#2B2B2B">
        {title}
      </Text>
    </group>
  )
}

function PostItWall({ x, width, tasks, selectedId, onSelect }: { x: number; width: number; tasks: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const list = tasks.filter((t) => t.status !== 'cancelled').sort((a, b) => a.created_at - b.created_at) // cancelled work leaves the wall
  const cols = Math.max(2, Math.floor((width - 0.2) / 1.5))
  const rowsN = 3
  const shown = list.slice(0, cols * rowsN)
  const W = cols * 1.5 + 0.2
  const H = 2.45
  return (
    // Cara interior de la pared norte (z=0), mirando hacia +z.
    <group position={[x, 1.72, 0.16]}>
      <mesh position={[0, 0, -0.01]}>
        <boxGeometry args={[W + 0.2, H + 0.2, 0.05]} />
        <meshLambertMaterial color="#7A4E2D" />
      </mesh>
      <mesh position={[0, 0, 0.02]}>
        <planeGeometry args={[W, H]} />
        <meshLambertMaterial color="#D9A86C" />
      </mesh>
      <Text position={[0, H / 2 + 0.3, 0.03]} fontSize={0.26} anchorX="center" font="/fonts/inter-black.ttf" color="#7A4E2D" letterSpacing={0.12}>
        TAREAS
      </Text>
      {shown.map((t, i) => {
        const c = i % cols
        const r = Math.floor(i / cols)
        const nx = (c - (cols - 1) / 2) * 1.5
        const ny = H / 2 - 0.55 - r * 0.78
        const tilt = ((i * 37) % 7 - 3) * 0.012
        return <Note key={t.id} task={t} n={i + 1} x={nx} y={ny} tilt={tilt} selected={t.id === selectedId} onSelect={onSelect} />
      })}
      {shown.length === 0 && (
        <Text position={[0, 0, 0.03]} fontSize={0.16} maxWidth={W - 0.6} textAlign="center" anchorX="center" anchorY="middle" font="/fonts/inter-black.ttf" color="#7A4E2D">
          Aquí aparecen las tareas cuando un agente las crea
        </Text>
      )}
      {list.length > shown.length && (
        <Text position={[W / 2 - 0.1, -H / 2 - 0.3, 0.03]} fontSize={0.14} anchorX="right" font="/fonts/inter-black.ttf" color="#7A4E2D">
          {`+${list.length - shown.length} más`}
        </Text>
      )}
    </group>
  )
}

// Laptop sobre el escritorio: se abre cuando el agente trabaja y se cierra cuando descansa. Un clic abre su sesión.
const SCREEN: Record<string, string> = { BUSY: '#2D6BFF', TALKING: '#2D6BFF', MAINTENANCE: '#F5A524', ERROR: '#E5484D', IDLE: '#14B8A6', OFFLINE: '#9AA6B6' }

const DESK_TOP = 1.1
const LAPTOP_DIST = 1.6

function Laptop({ position, rotation, status, selected, onClick }: any) {
  const lid = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const [hover, setHover] = useState(false)
  const open = status === 'BUSY' || status === 'TALKING' || status === 'MAINTENANCE' || status === 'ERROR'
  useFrame(({ clock }, dt) => {
    if (lid.current) {
      const target = open ? -1.8 : 0
      lid.current.rotation.x += (target - lid.current.rotation.x) * Math.min(1, dt * 6)
    }
    if (mat.current) {
      const k = status === 'BUSY' ? 0.8 + 0.2 * Math.sin(clock.elapsedTime * 6) : status === 'MAINTENANCE' ? 0.6 + 0.4 * Math.sin(clock.elapsedTime * 4) : 1
      mat.current.color.set(SCREEN[status] ?? '#9AA6B6').multiplyScalar(k)
    }
  })
  // forward = dirección en la que mira la persona; la laptop mira hacia ella. Va sobre el escritorio (cara superior a y=1.1),
  // centrada frente al asiento: el asiento está a ~1.7 del centro del escritorio, la laptop queda 0.1 hacia la persona.
  const fx = Math.sin(rotation)
  const fz = Math.cos(rotation)
  return (
    <group position={[position[0] + fx * LAPTOP_DIST, DESK_TOP + 0.025, position[2] + fz * LAPTOP_DIST]} rotation={[0, rotation + Math.PI, 0]} scale={hover || selected ? 1.12 : 1}
      onClick={(e: any) => { e.stopPropagation(); onClick() }}
      onPointerOver={(e: any) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { setHover(false); document.body.style.cursor = '' }}>
      <mesh castShadow>
        <boxGeometry args={[0.92, 0.05, 0.64]} />
        <meshLambertMaterial color={selected ? '#2D6BFF' : '#C9CED8'} />
      </mesh>
      <group ref={lid} position={[0, 0.025, -0.32]}>
        <mesh position={[0, 0.012, 0.32]} castShadow>
          <boxGeometry args={[0.92, 0.024, 0.64]} />
          <meshLambertMaterial color="#9AA3B2" />
        </mesh>
        <mesh position={[0, -0.001, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.82, 0.54]} />
          <meshBasicMaterial ref={mat} color={SCREEN[status] ?? '#9AA6B6'} />
        </mesh>
      </group>
    </group>
  )
}

// La persona usuaria: se mueve con WASD o las flechas, relativo a la cámara (arriba en pantalla = adelante).
function Player({ spawn, seat, interactions, onNearInteraction, onInteract, shared }: { spawn: [number, number, number]; seat?: { x: number; z: number; rotation: number } | null; interactions: Interaction[]; onNearInteraction: (id: string | null) => void; onInteract: (id: string) => void; shared: { current: any } }) {
  const near = useRef<string | null>(null)
  const list = useRef(interactions)
  list.current = interactions
  const cbs = useRef({ onNearInteraction, onInteract })
  cbs.current = { onNearInteraction, onInteract }
  // `seat`: si no es null, la persona está sentada ahí (el avatar toma la pose y se levanta solo al moverse); `seated` lo expone.
  const ctl = useRef<any>({ dx: 0, dz: 0, x: seat ? seat.x : spawn[0], z: seat ? seat.z : spawn[2], moving: false, run: false, seat: seat ?? null, seated: !!seat })
  // The camera rig reads the player's live position through this shared ref.
  useEffect(() => { shared.current = ctl.current; return () => { shared.current = null } }, [shared])
  const keys = useRef<Record<string, number>>({}) // tecla -> orden en que se presionó
  const order = useRef(0)
  const { camera } = useThree()
  const fwd = useMemo(() => new THREE.Vector3(), [])
  // Con ?debug se expone la posición para revisar el movimiento desde fuera.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('debug')) (window as any).__player = ctl.current
  }, [])

  useEffect(() => {
    const MAP: Record<string, string> = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' }
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') { if (!typing(e)) ctl.current.run = true; return }
      if (e.key.toLowerCase() === 'e') {
        if (!typing(e) && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && near.current) {
          const it = list.current.find((i) => i.id === near.current)
          if (it?.kind === 'sit' && it.seat) ctl.current.seat = { x: it.seat.x, z: it.seat.z, rotation: it.seat.rotation } // sentarse: lo resuelve el avatar
          else cbs.current.onInteract(near.current)
        }
        return
      }
      const k = MAP[e.key.toLowerCase()]
      if (!k || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (!keys.current[k]) keys.current[k] = ++order.current // el número recuerda cuál se presionó al último
      e.preventDefault() // las flechas no deben desplazar la página
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') ctl.current.run = false
      const k = MAP[e.key.toLowerCase()]
      if (k) delete keys.current[k]
    }
    // Si se pierde el foco con una tecla abajo nunca llega el "soltar": se limpia para que no quede una dirección pegada.
    const clear = () => { keys.current = {}; ctl.current.run = false }
    const vis = () => { if (document.hidden) clear() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  useFrame(() => {
    const k = keys.current
    // Si están abajo dos teclas opuestas, gana la que se presionó al último (así siempre se puede retroceder).
    const axis = (pos: number | undefined, neg: number | undefined) => (pos && neg ? (pos > neg ? 1 : -1) : pos ? 1 : neg ? -1 : 0)
    const v = axis(k.up, k.down)
    const h = axis(k.right, k.left)
    camera.getWorldDirection(fwd)
    fwd.y = 0
    // Mirando recto hacia abajo (vista superior) "adelante" es hacia donde apunta la parte de arriba de la pantalla (norte).
    if (fwd.lengthSq() < 1e-4) { fwd.set(camera.up.x, 0, camera.up.z); if (fwd.lengthSq() < 1e-4) fwd.set(-1, 0, -1) }
    fwd.normalize()
    const rx = -fwd.z
    const rz = fwd.x
    ctl.current.dx = fwd.x * v + rx * h
    ctl.current.dz = fwd.z * v + rz * h

    // Zona de interacción más cercana que contiene al jugador; al salir se deja un margen para que no parpadee en el borde.
    const { x, z } = ctl.current
    // Las zonas de «sentarse» ceden ante hablar/tablero (cuentan 0.8 más lejos) y no se ofrecen estando sentado.
    const seatedNow = !!ctl.current.seat
    const eff = (it: Interaction) => Math.hypot(x - it.x, z - it.z) + (it.kind === 'sit' ? 0.8 : 0)
    let best: Interaction | null = null
    let bestD = Infinity
    let cur: Interaction | null = null
    let curD = Infinity
    for (const it of list.current) {
      if (it.kind === 'sit' && seatedNow) continue
      const d = eff(it)
      const reach = it.radius + (it.kind === 'sit' ? 0.8 : 0)
      if (d <= reach && d < bestD) { best = it; bestD = d }
      if (it.id === near.current) { cur = it; curD = d }
    }
    let next = near.current
    if (cur && !(cur.kind === 'sit' && seatedNow) && curD <= cur.radius + (cur.kind === 'sit' ? 0.8 : 0) + 0.4) { if (best && best.id !== cur.id && bestD < curD - 0.5) next = best.id }
    else next = best ? best.id : null
    if (next !== near.current) { near.current = next; cbs.current.onNearInteraction(next) }
  })

  return (
    <Suspense fallback={null}>
      <VoxelAvatar faceIndex={10} position={seat ? [seat.x, 0, seat.z] : spawn} rotation={seat?.rotation} name="Tú" kind="human" status="IDLE" seated={false} control={ctl} />
    </Suspense>
  )
}

// Reacciones del personaje: salta cuando termina ("¡Listo!") y rebota cuando te hace una pregunta.
function Reaction({ status, doneAt, position, children }: any) {
  const g = useRef<THREE.Group>(null)
  const [badge, setBadge] = useState<'done' | null>(null)
  useEffect(() => {
    if (!doneAt) return
    setBadge('done')
    const t = setTimeout(() => setBadge(null), 6000)
    return () => clearTimeout(t)
  }, [doneAt])

  useFrame(({ clock }) => {
    if (!g.current) return
    let y = 0
    const since = doneAt ? Date.now() - doneAt : Infinity
    if (since < 2400) {
      const t = since / 1200 // dos saltos que se van apagando
      y = Math.abs(Math.sin(t * Math.PI)) * (1 - t / 2.4) * 0.8
    } else if (status === 'MAINTENANCE') {
      y = Math.abs(Math.sin(clock.elapsedTime * 3.4)) * 0.16 // rebote de "te necesito"
    }
    g.current.position.y = y
  })

  return (
    <group ref={g}>
      {children}
      {badge === 'done' && (
        <Html position={[position[0], 3.7, position[2]]} center sprite style={{ pointerEvents: 'none' }}>
          <div className="animate-bounce rounded-full bg-teal px-3 py-1 text-[11px] font-bold text-white shadow-none" style={{ border: '2px solid #fff' }}>
            ¡Listo!
          </div>
        </Html>
      )}
      {status === 'MAINTENANCE' && (
        <Html position={[position[0], 3.7, position[2]]} center sprite style={{ pointerEvents: 'none' }}>
          <div className="relative flex h-7 w-7 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-60" />
            <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-amber text-[15px] font-black text-white" style={{ border: '2px solid #fff' }}>?</span>
          </div>
        </Html>
      )}
    </group>
  )
}

type Chill = { spotId: string; phase: 'walking-to-chill' | 'chilling' | 'walking-to-desk'; path?: [number, number, number][] }


// Encuadra la oficina según su tamaño y el del lienzo. Vistas:
//   persp (por defecto): cámara con perspectiva en diagonal; lo lejano se ve más chico, así el piso no "sube" como una colina.
//   iso: isométrica (ortográfica, sin perspectiva).   top: desde arriba (norte arriba).
// Con `follow` la cámara se acerca y acompaña a la persona usuaria; el mouse sigue girando y acercando (sin mover el centro).
export type OfficeView = 'persp' | 'iso' | 'top'
const FOLLOW_ZOOM = 2.2
const PERSP_FOV = 38
const PERSP_ELEV = (26 * Math.PI) / 180 // inclinación sobre el piso: baja, casi de frente (tercera persona)
const PERSP_FOLLOW_DIST = 16 // cerca del personaje
function CameraRig({ layout, view, follow, player }: { layout: OfficeLayout; view: OfficeView; follow: boolean; player: { current: any } }) {
  const { camera, size } = useThree()
  const controls = useRef<any>(null)
  useEffect(() => {
    const [cx, cz] = layout.center
    const tx = follow ? (player.current?.x ?? layout.ceo?.seat.position[0] ?? layout.spawn[0]) : cx
    const tz = follow ? (player.current?.z ?? layout.ceo?.seat.position[2] ?? layout.spawn[2]) : cz
    const k = follow ? FOLLOW_ZOOM : 1
    if (view === 'persp') {
      const cam = camera as THREE.PerspectiveCamera
      const vfov = (PERSP_FOV * Math.PI) / 180
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / Math.max(1, size.height)))
      // Toda la oficina: distancia para que su círculo envolvente quepa en el campo de visión más angosto.
      const r = Math.hypot(layout.width, layout.depth) / 2
      const dist = follow ? PERSP_FOLLOW_DIST : (r * 0.82) / Math.sin(Math.min(vfov, hfov) / 2)
      const h = Math.cos(PERSP_ELEV) * dist
      camera.up.set(0, 1, 0)
      camera.position.set(tx + h * Math.SQRT1_2, Math.sin(PERSP_ELEV) * dist, tz + h * Math.SQRT1_2)
      cam.fov = PERSP_FOV
      cam.zoom = 1
    } else if (view === 'top') {
      const zoom = Math.min(size.width / (layout.width * 1.08), size.height / (layout.depth * 1.12))
      camera.up.set(0, 0, -1)
      camera.position.set(tx, ISO_DIST * 1.5, tz + 0.001)
      camera.zoom = zoom * k
    } else {
      const sum = layout.width + layout.depth
      const extX = sum / Math.SQRT2
      const extY = sum / Math.sqrt(6) + layout.wallHeight * 0.9
      const zoom = Math.min(size.width / (extX * 1.1), size.height / (extY * 1.2))
      camera.up.set(0, 1, 0)
      camera.position.set(tx + ISO_DIST, ISO_DIST, tz + ISO_DIST)
      camera.zoom = zoom * k
    }
    camera.lookAt(tx, 0, tz)
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(tx, 0, tz)
      controls.current.update()
    }
  }, [layout, view, follow, camera, size.width, size.height, player])
  // Mueve cámara y punto de mira juntos hacia la persona: se conserva el ángulo y el zoom que haya elegido con el mouse.
  useFrame((_, dt) => {
    const p = player.current
    const c = controls.current
    if (!follow || !p || !c) return
    const k = 1 - Math.exp(-dt * 7)
    const dx = (p.x - c.target.x) * k
    const dy = (0 - c.target.y) * k
    const dz = (p.z - c.target.z) * k
    c.target.x += dx; c.target.y += dy; c.target.z += dz
    camera.position.x += dx; camera.position.y += dy; camera.position.z += dz
  })
  return (
    <OrbitControls key={view} ref={controls} enablePan={!follow} enableZoom enableRotate={view !== 'top'}
      minZoom={6} maxZoom={110} minDistance={6} maxDistance={160} maxPolarAngle={view === 'persp' ? 1.35 : Math.PI / 2} />
  )
}

/** Aviso estilo Roblox: tecla «E» + etiqueta, flotando sobre el objetivo (el agente o el tablero), no sobre la persona. */
function InteractPrompt({ it, at, codex, cowork }: { it: Interaction; at: [number, number, number]; codex?: boolean; cowork?: boolean }) {
  return (
    <Html position={at} center sprite style={{ pointerEvents: 'none' }}>
      <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-ink shadow-none">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-ink bg-surface text-sm font-extrabold">E</span>
        <span className="flex flex-col leading-tight">
          <span className="text-xs font-semibold">{it.label}</span>
          {it.kind === 'talk' && <span className="text-[10px] text-muted">{codex ? 'Abre la conversación en Codex' : cowork ? 'Su tarea está en Cowork' : 'Abre la conversación en Claude Desktop'}</span>}
        </span>
      </div>
    </Html>
  )
}

function Scene({ teamNames, view, follow, dark, player, onInteract, chars, layout, ready, chill, doneAt, onPathDone, onBuilt, tasks, selectedTask, onSelectTask, selectedSeat, onSelectSeat, codexKeys, coworkKeys }: any) {
  const [nearId, setNearId] = useState<string | null>(null)
  // Zonas del tablero y del Assistant + una por cada personaje (en su escritorio o sillón; los que caminan no).
  const interactions = useMemo(() => {
    const list: Interaction[] = [...layout.interactions]
    chars.forEach((c: any, i: number) => {
      const seat = layout.seats[c.slot]
      if (!seat || seat.zone === 'reception') return
      const ch = seat.standing ? undefined : chill.get(c.key)
      let pos = seat.position
      if (ch) {
        if (ch.phase !== 'chilling') return
        const spot = layout.chill.find((s: any) => s.id === ch.spotId)
        if (spot) pos = spot.position
      }
      list.push({ id: `agent:${c.key}`, kind: 'talk', x: pos[0], z: pos[2], radius: 2.8, label: `Hablar con ${c.name}`, target: c.key })
    })
    // Zonas de «sentarse» en cada lugar libre: escritorios sin personaje, sillas de juntas y sitios del lounge sin ocupar.
    const taken = new Set<number>(chars.map((c: any) => c.slot))
    const busySpots = new Set<string>()
    chill.forEach((e: any) => busySpots.add(e.spotId))
    layout.seats.forEach((seat: any, i: number) => {
      if (seat.standing || seat.zone === 'reception' || taken.has(i)) return
      list.push({ id: `sit:seat-${i}`, kind: 'sit', x: seat.position[0], z: seat.position[2], radius: 1.1, label: 'Sentarte', seat: { x: seat.position[0], z: seat.position[2], rotation: seat.rotation } })
    })
    layout.chill.forEach((spot: any) => {
      if (busySpots.has(spot.id)) return
      list.push({ id: `sit:${spot.id}`, kind: 'sit', x: spot.position[0], z: spot.position[2], radius: 1.1, label: 'Sentarte', seat: { x: spot.position[0], z: spot.position[2], rotation: spot.rotation } })
    })
    return list
  }, [layout, chars, chill])
  const nearIt = interactions.find((i) => i.id === nearId) ?? null
  // Dónde flota el aviso: sobre la cabeza del agente (por encima de su etiqueta) o sobre el tablero de la pared.
  const promptAt = useMemo((): [number, number, number] | null => {
    if (!nearIt) return null
    if (nearIt.kind === 'board') return [layout.board.x, 3.55, 0.5]
    if (nearIt.kind === 'sit') return [nearIt.x, 3.2, nearIt.z]
    const idx = chars.findIndex((c: any) => c.key === nearIt.target)
    const seat = idx >= 0 ? layout.seats[chars[idx].slot] : null
    const base = nearIt.id.startsWith('agent:') || !seat ? [nearIt.x, nearIt.z] : [seat.position[0], seat.position[2]]
    return [base[0], 4.3, base[1]]
  }, [nearIt, chars, layout])
  return (
    <>
      {nearIt && promptAt && <InteractPrompt it={nearIt} at={promptAt} codex={codexKeys?.includes(nearIt.id === 'assistant' ? 'coo' : nearIt.target ?? '')} cowork={coworkKeys?.includes(nearIt.id === 'assistant' ? 'coo' : nearIt.target ?? '')} />}
      {/* Luz cálida, como la de las referencias */}
      {/* Luz según la hora real de la persona (?hour=21 para ver otra hora) */}
      <Daylight layout={layout} dark={dark} />

      <ParametricOffice layout={layout} onBuilt={onBuilt} />
      {/* Nombre de cada equipo, escrito en el piso al norte de su isla */}
      {layout.islands.map((isl: any) => teamNames[isl.team] ? (
        <Text key={`team-${isl.team}`} position={[isl.x0 + 0.2, 0.06, isl.z0 - 0.15]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.5} maxWidth={isl.x1 - isl.x0 - 0.4} anchorX="left" anchorY="bottom" font="/fonts/inter-black.ttf" color={dark ? '#9DB8FF' : '#1F4FD8'} letterSpacing={0.06}>
          {String(teamNames[isl.team]).toUpperCase()}
        </Text>
      ) : null)}
      <PostItWall x={layout.board.x} width={layout.board.width} tasks={tasks} selectedId={selectedTask} onSelect={onSelectTask} />

      {chars.map((c: any, i: number) => {
        const seat = layout.seats[c.slot]
        if (!seat) return null
        const ch = seat.standing ? undefined : chill.get(c.key)
        let position = seat.position
        let rotation = seat.rotation
        let path: any
        let seated = !seat.standing
        if (ch) {
          const spot = layout.chill.find((s: any) => s.id === ch.spotId)
          if (ch.phase !== 'chilling') {
            path = ch.path
            seated = false
            // Desde dónde arranca: al ir al descanso sale de su escritorio; al volver, del sillón.
            if (ch.phase === 'walking-to-desk' && spot) position = spot.position
          } else {
            if (spot) {
              position = spot.position
              rotation = spot.rotation
            }
            seated = true
          }
        }
        return (
          <Suspense key={c.key} fallback={null}>
            {!seat.standing && seat.zone !== 'reception' && <Laptop position={seat.position} rotation={seat.rotation} status={c.status} selected={c.key === selectedSeat} onClick={() => onSelectSeat(c.key)} />}
            <Reaction status={c.status} doneAt={doneAt.get(c.key)} position={position}>
              <VoxelAvatar
                faceIndex={c.faceIndex ?? i}
                position={position}
                rotation={rotation}
                name={c.name}
                kind={c.kind}
                status={c.status}
                seated={seated}
                standing={seat.standing}
                path={path}
                onPathComplete={path ? () => onPathDone(c.key) : undefined}
                bubble={c.bubble}
                onSelect={() => onInteract(`agent:${c.key}`)}
              />
            </Reaction>
          </Suspense>
        )
      })}
      {ready && <Player key={`${layout.width}x${layout.depth}`} spawn={layout.spawn} seat={layout.ceo ? { x: layout.ceo.seat.position[0], z: layout.ceo.seat.position[2], rotation: layout.ceo.seat.rotation } : null} interactions={interactions} onNearInteraction={setNearId} onInteract={onInteract} shared={player} />}
      {view === 'persp'
        ? <PerspectiveCamera makeDefault fov={PERSP_FOV} near={0.1} far={600} position={[30, 40, 30]} />
        : <OrthographicCamera makeDefault zoom={20} near={0.1} far={500} position={[30, 60, 60]} />}
      <CameraRig layout={layout} view={view} follow={follow} player={player} />
    </>
  )
}

export default function OfficeScene({ seats, teams, tasks, selectedTask, onSelectTask, selectedSeat, onSelectSeat, onInteract, projectName, codexKeys, coworkKeys }: { codexKeys?: string[]; coworkKeys?: string[]; projectName?: string; seats: TeamSeat[]; teams: { name: string; size: number }[]; tasks: Task[]; selectedTask: string | null; onSelectTask: (id: string) => void; selectedSeat: string | null; onSelectSeat: (key: string | null) => void; onInteract: (id: string) => void }) {
  // Vista: perspectiva por defecto; ?view=iso|top|persp o los botones la cambian (se recuerda en el navegador).
  const [view, setView] = useState<OfficeView>('persp')
  useEffect(() => {
    try {
      const ok = (v: string | null): v is OfficeView => v === 'persp' || v === 'iso' || v === 'top'
      const q = new URLSearchParams(window.location.search).get('view')
      const saved = window.localStorage.getItem('backoffice.officeView2')
      setView(ok(q) ? q : ok(saved) ? saved : 'persp')
    } catch {}
  }, [])
  const chooseView = (v: OfficeView) => {
    setView(v)
    try { window.localStorage.setItem('backoffice.officeView2', v) } catch {}
  }
  // Cámara: sigue a la persona por defecto (se recuerda); «Vista completa» encuadra toda la oficina.
  const [follow, setFollow] = useState(true)
  useEffect(() => { try { if (window.localStorage.getItem('backoffice.officeFollow') === '0') setFollow(false) } catch {} }, [])
  const toggleFollow = () => {
    const f = !follow
    setFollow(f)
    try { window.localStorage.setItem('backoffice.officeFollow', f ? '1' : '0') } catch {}
  }
  const player = useRef<any>(null)
  const dark = useTheme().theme === 'dark'
  const daylight = useDaylight()
  // The entrance wall shows the project (workspace) name. Con equipos, cada uno tiene su isla (tamaños en orden).
  const teamNames = useMemo(() => teams.map((t) => t.name), [teams])
  const sizesKey = teams.map((t) => t.size).join(',')
  const layout = useMemo(
    () => generateOffice(seats.length, projectName?.trim() ? projectName.trim().toUpperCase() : undefined, { coo: true, teams: sizesKey ? sizesKey.split(',').map(Number) : undefined }),
    [seats.length, projectName, sizesKey],
  )
  // Escritorio (índice en layout.seats) de cada personaje: la COO en recepción, cada miembro en la isla de su equipo
  // y el resto (visitas, sesiones sueltas) en las plazas del lobby. Sin equipos, uno a uno.
  const slots = useMemo(() => {
    if (!sizesKey) return seats.map((_, i) => i)
    const byTeam = new Map<number, number[]>()
    const lobby: number[] = []
    layout.seats.forEach((l, i) => {
      if (l.zone === 'cowork' && l.team !== undefined) byTeam.set(l.team, [...(byTeam.get(l.team) ?? []), i])
      else if (l.zone === 'lobby') lobby.push(i)
    })
    const used = new Map<number, number>()
    let li = 0
    return seats.map((s) => {
      if (s.key === 'coo') return 0
      if (s.team === undefined) return lobby[li++] ?? -1
      const n = used.get(s.team) ?? 0
      used.set(s.team, n + 1)
      return byTeam.get(s.team)?.[n] ?? -1
    })
  }, [seats, layout, sizesKey])
  const chars = useMemo(
    () =>
      seats.map((s, i) => ({
        key: s.key,
        slot: slots[i],
        name: s.member.name,
        kind: ['cmo', 'researcher', 'creative', 'analyst', 'coo'].includes(s.member.id) ? s.member.id : 'claude',
        // El COO nunca se va al lounge: sin sesión está en su oficina, libre.
        status: s.member.id === 'coo' && s.status === 'offline' ? 'IDLE' : STATUS_MAP[s.status],
        faceIndex: s.member.face ?? FACE_BY_ID[s.member.id] ?? FACE_FALLBACK[i % FACE_FALLBACK.length],
        bubble: s.status === 'waiting' ? s.detail : null,
      })),
    [seats, slots],
  )

  // "Listo": un agente que estaba trabajando pasa a libre.
  const prevStatus = useRef<Map<string, string>>(new Map())
  const [doneAt, setDoneAt] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    const fresh: [string, number][] = []
    for (const c of chars) {
      const before = prevStatus.current.get(c.key)
      if ((before === 'BUSY' || before === 'TALKING') && c.status === 'IDLE') fresh.push([c.key, Date.now()])
      prevStatus.current.set(c.key, c.status)
    }
    if (fresh.length) setDoneAt((m) => new Map([...m, ...fresh]))
  }, [chars])

  const [chill, setChill] = useState<Map<string, Chill>>(new Map())
  const chillRef = useRef(chill)
  chillRef.current = chill
  const [nav, setNav] = useState<any>(null)
  // Claves ya evaluadas con la malla actual: la primera vez que aparecen, los de lounge se colocan sin caminar.
  const initRef = useRef<Set<string>>(new Set())

  // Al armarse la oficina se calcula la malla de navegación con sus muebles como obstáculos.
  const onBuilt = useCallback((obstacles: any[]) => {
    const anchors: [number, number, number][] = [
      ...layout.seats.map((s) => [s.position[0], s.position[2], 1.0] as [number, number, number]),
      ...layout.chill.map((s) => [s.position[0], s.position[2], 1.7] as [number, number, number]),
      ...[layout.ceo.seat, ...layout.ceo.visitors].map((s) => [s.position[0], s.position[2], 1.0] as [number, number, number]),
    ]
    const grid = createOfficeNavGrid(obstacles, anchors, { minX: 0, minZ: 0, maxX: layout.width, maxZ: layout.depth }, 0.2)
    setActiveNavGrid(grid)
    initRef.current = new Set()
    setChill(new Map()) // el layout cambió: cada quien vuelve a su escritorio
    setNav({ grid, layout })
  }, [layout])

  const onPathDone = useCallback((key: string) => {
    setChill((prev) => {
      const next = new Map(prev)
      const e = next.get(key)
      if (!e) return prev
      if (e.phase === 'walking-to-chill') next.set(key, { ...e, phase: 'chilling', path: undefined })
      else if (e.phase === 'walking-to-desk') next.delete(key)
      return next
    })
  }, [])

  // Los que están fuera de línea caminan al lounge; en cuanto hay actividad vuelven a su escritorio.
  useEffect(() => {
    // La malla debe ser la del layout actual: tras un cambio de tamaño hay un instante con la anterior.
    if (!nav || nav.layout !== layout) return
    const used = new Set<string>()
    for (const [, e] of chillRef.current) used.add(e.spotId)
    const upd = new Map(chillRef.current)
    let changed = false
    chars.forEach((c, i) => {
      const seat = layout.seats[c.slot]
      if (!seat || seat.standing) return
      const ex = upd.get(c.key)
      const first = !initRef.current.has(c.key)
      initRef.current.add(c.key)
      if (c.status === 'OFFLINE') {
        if (!ex) {
          const free = layout.chill.find((s) => !used.has(s.id))
          if (free && first) {
            // Primera aparición: nace directo en el lounge, sin caminar desde el escritorio.
            used.add(free.id)
            upd.set(c.key, { spotId: free.id, phase: 'chilling' })
            changed = true
          } else if (free) {
            used.add(free.id)
            const path = nav.grid.findPath(seat.position[0], seat.position[2], free.position[0], free.position[2])
            if (path.length > 0) {
              upd.set(c.key, { spotId: free.id, phase: 'walking-to-chill', path })
              changed = true
            }
          }
        }
      } else if (ex && (ex.phase === 'chilling' || ex.phase === 'walking-to-chill')) {
        const spot = layout.chill.find((s) => s.id === ex.spotId)
        const fx = ex.phase === 'chilling' && spot ? spot.position[0] : seat.position[0]
        const fz = ex.phase === 'chilling' && spot ? spot.position[2] : seat.position[2]
        const path = nav.grid.findPath(fx, fz, seat.position[0], seat.position[2])
        upd.set(c.key, { spotId: ex.spotId, phase: 'walking-to-desk', path: path.length > 0 ? path : undefined })
        changed = true
      }
    })
    for (const k of Array.from(initRef.current)) if (!chars.some((c) => c.key === k)) initRef.current.delete(k)
    for (const k of Array.from(upd.keys())) if (!chars.some((c) => c.key === k)) { upd.delete(k); changed = true }
    if (changed) setChill(upd)
  }, [chars, nav, layout])

  return (
    <div className="relative h-full w-full">
    <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
      <button type="button" onClick={toggleFollow} data-testid="follow-toggle" aria-pressed={follow}
        aria-label={follow ? 'Vista completa' : 'Seguirme'} title={follow ? 'Vista completa' : 'Seguirme'}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line bg-surface/80 text-muted backdrop-blur hover:bg-surface">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {follow
            ? <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            : <><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>}
        </svg>
      </button>
      <div role="group" aria-label="Ángulo de la cámara" data-testid="view-toggle" className="flex rounded-full border border-line bg-surface/80 p-0.5 text-[11px] font-medium backdrop-blur">
        {([['persp', 'Perspectiva'], ['iso', 'Isométrica'], ['top', 'Superior']] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => chooseView(v)} aria-pressed={view === v}
            className={`rounded-full px-3 py-0.5 ${view === v ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
    <Canvas shadows="soft" className="h-full w-full" gl={{ antialias: true, alpha: true, toneMappingExposure: 1.12 }}>
      <color key={dark ? 'd' : daylight.background} attach="background" args={[dark ? '#12151B' : daylight.background]} />
      <Suspense fallback={null}>
        <Scene teamNames={teamNames} view={view} follow={follow} dark={dark} player={player} onInteract={onInteract} chars={chars} layout={layout} ready={!!nav && nav.layout === layout} chill={chill} doneAt={doneAt} onPathDone={onPathDone} onBuilt={onBuilt} tasks={tasks} selectedTask={selectedTask} onSelectTask={onSelectTask} selectedSeat={selectedSeat} onSelectSeat={onSelectSeat} codexKeys={codexKeys} coworkKeys={coworkKeys} />
      </Suspense>
    </Canvas>
    </div>
  )
}
