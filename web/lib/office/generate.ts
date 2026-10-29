// Generador paramétrico de la oficina: dado el número de asientos arma una oficina compacta cuyo corazón es el
// área de trabajo abierta. La oficina del CEO (la persona usuaria, cuarto de cristal al noroeste) y la sala de juntas abren directo a esa área; el COO es la recepcionista.
// Es una función pura (sin three.js), así que se puede probar y reutilizar en el servidor.
//
// Ángulos: un objeto con ángulo `a` mira hacia (sin a, cos a). Origen en la esquina noroeste; las paredes
// del fondo son x=0 (oeste) y z=0 (norte). Medidas en las unidades de Office.glb.
//
// Composición (x crece al este, z al sur; la entrada está al sur):
//
//   z=0  +-----------+-----------------------------+------------+
//        | OFICINA   |  tablero de tareas (norte)  | SALA DE    |
//        | DEL CEO   |  + zona neón                | JUNTAS     |
//        | (cristal)>|      ÁREA DE TRABAJO     <-puerta        |
//   RD   +-----------+  (islas por equipo)         +--sólido----+
//        | café +    |                             | recepción  |
//        | lounge    |                             | (COO) +    |
//   D    +-----------+-------------------------------[entrada]-+
//
//   El lounge siempre va en la columna oeste, bajo la oficina del CEO (junto al café).

export interface Placement {
  id: string
  x: number
  z: number
  /** Altura de la base (para objetos colgados en la pared). */
  y?: number
  facing: number
}

export interface SeatSlot {
  position: [number, number, number]
  rotation: number
  zone: 'cowork' | 'meeting' | 'lobby' | 'reception'
  standing?: boolean
  /** Índice del equipo dueño de la isla (solo con `opts.teams`). */
  team?: number
}

/** Isla de un equipo (solo con `opts.teams`): su huella en el piso, para rotularla. */
export interface Island {
  team: number
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface ChillSpot {
  id: string
  position: [number, number, number]
  rotation: number
  type: 'sofa' | 'chair'
}

/** Pared o muro como caja alineada a los ejes (centro y medidas). */
export interface Wall {
  x: number
  z: number
  w: number
  d: number
  h: number
  /** Altura de la base (por defecto 0): para el antepecho y el dintel de una ventana. */
  y0?: number
  /** 'solid' = pared; 'glass' = cristal con marco metálico; 'knee' = muro bajo del frente. */
  kind: 'solid' | 'glass' | 'knee'
}

/** Ventana de cristal en un muro sólido (el muro se parte alrededor). */
export interface Win {
  x: number
  z: number
  w: number
  y0: number
  y1: number
}

export interface Sign {
  text: string
  x: number
  y: number
  z: number
  /** Ángulo hacia donde mira el texto (0 = +Z, π/2 = +X). */
  facing: number
  size: number
  maxWidth?: number
  metal?: boolean
}

/** Diseño del tapete: 'frame' (campo liso con marco), 'diamond' (rombos), 'stripes' (franjas) o 'plain'. */
export type RugStyle = 'frame' | 'diamond' | 'stripes' | 'plain'

export interface Rug {
  x: number
  z: number
  w: number
  d: number
  /** Color base del campo. */
  color: string
  style?: RugStyle
  /** Color del dibujo (marco, rombos o franjas). */
  accent?: string
}

/** Puerta en un muro vertical (a lo largo de z) ubicado en `x`: el hueco va de z0 a z1. */
export interface Door {
  x: number
  z0: number
  z1: number
}

/** Zona invisible de interacción: al entrar en su radio aparece el aviso «E» con su etiqueta. */
export interface Interaction { id: string; kind: 'board' | 'talk' | 'sit'; x: number; z: number; radius: number; label: string; target?: string; /** Solo 'sit': dónde queda sentada la persona. */ seat?: { x: number; z: number; rotation: number } }

export interface OfficeLayout {
  seatCount: number
  modules: number
  cols: number
  rows: number
  width: number
  depth: number
  wallHeight: number
  placements: Placement[]
  rugs: Rug[]
  seats: SeatSlot[]
  /** Una isla por equipo (vacío sin `opts.teams`). */
  islands: Island[]
  chill: ChillSpot[]
  walls: Wall[]
  windows: Win[]
  signs: Sign[]
  /** Dónde aparece la persona usuaria: justo adentro de la entrada. */
  spawn: [number, number, number]
  /** Sala de juntas de cristal: límites y puerta (sobre su muro oeste, que da al área de trabajo). */
  meeting: { x0: number; x1: number; z0: number; z1: number; door: Door }
  /** Oficina del CEO (la persona usuaria): cuarto de cristal al noroeste, puerta en su muro este y su silla. */
  ceo: { x0: number; x1: number; z0: number; z1: number; door: Door; seat: { position: [number, number, number]; rotation: number }; visitors: { position: [number, number, number]; rotation: number }[] }
  /** Tablero de notas: centro sobre la pared norte. */
  board: { x: number; width: number }
  /** Área marcada frente al tablero: al pararse ahí se abre su pantalla. */
  boardZone: { x0: number; x1: number; z0: number; z1: number }
  /** Zonas de interacción (invisibles): tablero de tareas y, con COO, hablar con la recepcionista. */
  interactions: Interaction[]
  center: [number, number]
  zones: Record<string, { x: number; z: number; w: number; d: number }>
}

export const ISLE_GAP = 2.7 // pasillo mínimo entre islas de escritorios: un avatar más la silla afuera
const ISLE_W = 4.8
const ISLE_D = 5.76 // de la silla de atrás a la silla de enfrente
const BENCH_PITCH = ISLE_W + ISLE_GAP
const ROW_PITCH = ISLE_D + ISLE_GAP
const SEAT_DX = 1.15
const FRONT_CHAIR = 2.33 // del centro de la isla a la silla del lado +z
const BACK_CHAIR = 2.31
const BENCH_OFF = 0.62
const BOARD_ZONE_W = 2.0 // ancho del área frente al tablero de tareas
const WW = 8.4 // ancho de la columna oeste = oficina del CEO arriba; café y lounge abajo
const EW = 9.2 // ancho de la columna este: sala de juntas arriba; recepción y entrada abajo
const AISLE = 2.8 // pasillo libre a cada lado de las islas (las puertas de los cuartos dan a él)
const RD = 8.0 // fondo de los dos cuartos de cristal
/** Separación mínima de lo que va pegado a la pared (para no atravesarla). */
const FLUSH = 0.05
const TOP = 3.6 // pared norte a la primera isla: ahí va el tablero de notas
const MAX_COLS = 3
const MAX_ROW_W = MAX_COLS * ISLE_W + (MAX_COLS - 1) * ISLE_GAP // ancho máximo de una fila de islas por equipo
const DOOR_Z0 = 5.6 // puertas de 1.8 de ancho, en la parte sur de cada cuarto
const DOOR_Z1 = 7.4
const T = 0.26
/** Hacia dónde mira quien se sienta en la silla de recepción (hacia la entrada, al sur). */
const RECEPTIONIST_FACING = 0
const H = 3

export const MIN_SEATS = 4

/** Mitades de la huella de cada pieza [x, z] con el frente hacia +Z (medidas reales de los prefabs). */
export const FOOT: Record<string, [number, number]> = {
  bench: [2.4, 0.6],
  desk: [1.6, 0.55],
  chair: [0.45, 0.55],
  'meet-table': [2.4, 1.22],
  'meet-chair': [0.45, 0.55],
  whiteboard: [1.1, 0.1],
  sofa: [1.35, 0.7],
  'lounge-chair': [0.45, 0.55],
  'low-table': [1.25, 0.6],
  'pool-table': [1.8, 1.0],
  'side-table': [0.35, 0.35],
  'reception-desk': [1.5, 1.5],
  'reception-chair': [0.45, 0.55],
  'coffee-bar': [1.6, 0.6],
  'plant-tall': [0.4, 0.4],
  bookshelf: [0.55, 0.35],
  painting: [0.65, 0.05],
}

export interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** Caja en el piso de una pieza colocada (rota la huella según su ángulo, que siempre es múltiplo de 90°). */
export function placementBox(p: Placement): Rect {
  const [hx, hz] = FOOT[p.id] ?? [0.4, 0.4]
  const turned = Math.abs(Math.sin(p.facing)) > 0.7
  const ax = turned ? hz : hx
  const az = turned ? hx : hz
  return { minX: p.x - ax, maxX: p.x + ax, minZ: p.z - az, maxZ: p.z + az }
}

/** Piezas que cuelgan de la pared: no ocupan piso. */
export const isWallMounted = (p: Placement) => (p.y ?? 0) > 0.3

/**
 * `opts.coo`: la COO es la recepcionista: su asiento (`seats[0]`, zona `reception`) es la silla del mostrador de la entrada.
 * Cuenta dentro de `seatCount`: los escritorios del área de trabajo son para los demás.
 * `opts.teams`: miembros por equipo (sin la COO). Cada equipo tiene UNA isla de `max(1, ceil(m/4))` parejas de escritorios
 * pegadas a lo largo de x; las islas se reparten en filas. Los asientos van en orden: COO, equipo 1, equipo 2… (cada uno
 * con su `team`); sin `teams` se conserva el reparto numérico de siempre.
 */
export function generateOffice(seatCount: number, companyName = 'BACK OFFICE', opts: { coo?: boolean; teams?: number[] } = {}): OfficeLayout {
  const coo = !!opts.coo
  const n = Math.max(MIN_SEATS, Math.floor(seatCount))
  const teamMode = !!opts.teams && opts.teams.length > 0
  // Parejas de escritorios (cada una = 4 asientos) con el centro de su isla; en modo equipos, con su equipo.
  const pairs: { ix: number; zc: number; team?: number }[] = []
  const islands: Island[] = []
  let modules: number
  let cols: number
  let rows: number
  let coworkW: number
  if (teamMode) {
    const ks = opts.teams!.map((m) => Math.max(1, Math.ceil(m / 4)))
    // Reparto en filas: se llena cada fila hasta MAX_ROW_W; una isla más ancha que eso va sola.
    const rowsOf: number[][] = [[]]
    let cur = 0
    ks.forEach((k, t) => {
      const w = k * ISLE_W
      const row = rowsOf[rowsOf.length - 1]
      if (row.length && cur + ISLE_GAP + w > MAX_ROW_W + 1e-9) { rowsOf.push([]); cur = 0 }
      const r = rowsOf[rowsOf.length - 1]
      cur += (r.length ? ISLE_GAP : 0) + w
      r.push(t)
    })
    const rowW = rowsOf.map((r) => r.reduce((a, t, i) => a + (i ? ISLE_GAP : 0) + ks[t] * ISLE_W, 0))
    coworkW = Math.max(...rowW)
    modules = ks.reduce((a, k) => a + k, 0)
    rows = rowsOf.length
    cols = Math.max(...rowsOf.map((r) => r.reduce((a, t) => a + ks[t], 0)))
    rowsOf.forEach((r, ri) => {
      const zc = TOP + 2.8 + ri * ROW_PITCH
      let x = (coworkW - rowW[ri]) / 2 // cada fila centrada en el área de trabajo (en coordenadas relativas)
      for (const t of r) {
        const x0 = x
        for (let p = 0; p < ks[t]; p++) { pairs.push({ ix: x + ISLE_W / 2, zc, team: t }); x += ISLE_W }
        islands.push({ team: t, x0, x1: x, z0: zc - ISLE_D / 2, z1: zc + ISLE_D / 2 })
        x += ISLE_GAP
      }
    })
    islands.sort((a, b) => a.team - b.team)
  } else {
    modules = Math.ceil((n - (coo ? 1 : 0)) / 4)
    // 1–2 islas: en fila; 3–4: dos columnas (más cuadrado que una fila de tres); más: tres columnas.
    cols = modules <= 2 ? modules : modules <= 4 ? 2 : MAX_COLS
    rows = Math.ceil(modules / cols)
    coworkW = cols * ISLE_W + (cols - 1) * ISLE_GAP
    for (let m = 0; m < modules; m++) pairs.push({ ix: (m % cols) * BENCH_PITCH + ISLE_W / 2, zc: TOP + 2.8 + Math.floor(m / cols) * ROW_PITCH })
  }
  const cw = coworkW + 2 * AISLE // columna central: el área de trabajo, con su pasillo a cada lado
  const xc0 = WW // inicio de la columna central
  const coworkX0 = xc0 + AISLE
  const xe0 = xc0 + cw // inicio de la columna este
  const width = xe0 + EW
    const islandsEnd = TOP + 2.8 + (rows - 1) * ROW_PITCH + FRONT_CHAIR + 0.6
  const depth = Math.max(islandsEnd + 2.4, RD + 6.6) // el fondo mínimo aloja el café y un grupo de lounge bajo la oficina del CEO

  const placements: Placement[] = []
  const seats: SeatSlot[] = []
  const rugs: Rug[] = []
  const chill: ChillSpot[] = []

  // ── Área de trabajo: islas de 2 escritorios espalda con espalda = 4 asientos ──
  for (const { ix: rx0, zc, team } of pairs) {
    const ix = coworkX0 + rx0
    const tag = team === undefined ? {} : { team }
    placements.push({ id: 'bench', x: ix, z: zc + BENCH_OFF, facing: 0 })
    placements.push({ id: 'bench', x: ix, z: zc - BENCH_OFF, facing: Math.PI })
    const front = (dx: number): SeatSlot => ({ position: [ix + dx, 0, zc + FRONT_CHAIR], rotation: Math.PI, zone: 'cowork', ...tag })
    const back = (dx: number): SeatSlot => ({ position: [ix + dx, 0, zc - BACK_CHAIR], rotation: 0, zone: 'cowork', ...tag })
    for (const dx of [-SEAT_DX, SEAT_DX]) placements.push({ id: 'chair', x: ix + dx, z: zc + FRONT_CHAIR, facing: Math.PI })
    for (const dx of [-SEAT_DX, SEAT_DX]) placements.push({ id: 'chair', x: ix + dx, z: zc - BACK_CHAIR, facing: 0 })
    // Orden de ocupación: en diagonal, para que las primeras personas no queden pegadas.
    seats.push(front(-SEAT_DX), back(SEAT_DX), front(SEAT_DX), back(-SEAT_DX))
  }
  for (const i of islands) { i.x0 += coworkX0; i.x1 += coworkX0 }
  const coworkCenterX = coworkX0 + coworkW / 2
  // Huecos de la última fila sin isla: rincón de conversación rápida (mesa baja y dos sillones).
  const slots = teamMode ? modules : rows * cols
  for (let m = modules; m < slots; m++) {
    const sx = coworkX0 + ISLE_W / 2 + (m % cols) * BENCH_PITCH
    const sz = TOP + 2.8 + Math.floor(m / cols) * ROW_PITCH
    placements.push({ id: 'low-table', x: sx, z: sz, facing: 0 })
    placements.push({ id: 'lounge-chair', x: sx - 1.9, z: sz, facing: Math.PI / 2 })
    placements.push({ id: 'lounge-chair', x: sx + 1.9, z: sz, facing: -Math.PI / 2 })
    rugs.push({ x: sx, z: sz, w: 4.8, d: 3.2, color: '#B5573A', accent: '#F2E2C4', style: 'stripes' })
    chill.push({ id: `chill-huddle-${m}a`, position: [sx - 1.9, 0, sz], rotation: Math.PI / 2, type: 'chair' })
    chill.push({ id: `chill-huddle-${m}b`, position: [sx + 1.9, 0, sz], rotation: -Math.PI / 2, type: 'chair' })
  }
  rugs.push({ x: coworkCenterX, z: TOP + 2.8 + ((rows - 1) * ROW_PITCH) / 2, w: coworkW + 0.6, d: (rows - 1) * ROW_PITCH + ISLE_D + 0.4, color: '#E6D9C1', accent: '#BFAE90', style: 'frame' })

  // ── Oficina del CEO (noroeste, de cristal): escritorio de frente al cuarto, sillas de visita, librero, planta y cuadro ──
  const walls: Wall[] = []
  const box = (xa: number, xb: number, za: number, zbb: number, h: number, kind: Wall['kind'] = 'solid', y0 = 0) =>
    walls.push({ x: (xa + xb) / 2, z: (za + zbb) / 2, w: xb - xa, d: zbb - za, h, kind, ...(y0 ? { y0 } : {}) })
  const signs: Sign[] = []
  const windows: Win[] = []
  const ceoX = WW / 2
  const ceoDoor: Door = { x: WW, z0: DOOR_Z0, z1: DOOR_Z1 }
  const DESK_Z = 3.2
  const ceoSeat = { position: [ceoX, 0, DESK_Z - 1.71] as [number, number, number], rotation: 0 } // el escritorio mira al sur (facing π): la silla queda al norte, de cara al cuarto
  const visitors = [-0.9, 0.9].map((dx) => ({ position: [ceoX + dx, 0, DESK_Z + 1.7] as [number, number, number], rotation: Math.PI }))
  placements.push({ id: 'desk', x: ceoX, z: DESK_Z, facing: Math.PI })
  placements.push({ id: 'chair', x: ceoSeat.position[0], z: ceoSeat.position[2], facing: 0 })
  for (const v of visitors) placements.push({ id: 'chair', x: v.position[0], z: v.position[2], facing: Math.PI })
  placements.push({ id: 'bookshelf', x: FLUSH + 0.35, z: 2.0, facing: Math.PI / 2 })
  placements.push({ id: 'painting', x: 0.12, z: 5.4, y: 1.1, facing: Math.PI / 2 })
  placements.push({ id: 'plant-tall', x: FLUSH + 0.45, z: FLUSH + 0.45, facing: 0 }) // esquina noroeste (la noreste se deja libre: es el paso a la silla)
  placements.push({ id: 'plant-tall', x: FLUSH + 0.45, z: RD - 0.8, facing: 0 })
  rugs.push({ x: ceoX, z: 3.6, w: 6.0, d: 4.6, color: '#3B4A6B', accent: '#C9B27C', style: 'frame' })
  windows.push({ x: ceoX, z: -T / 2, w: 2.4, y0: 1.0, y1: 2.4 })
  box(WW - T / 2, WW + T / 2, 0, ceoDoor.z0, H, 'glass')
  box(WW - T / 2, WW + T / 2, ceoDoor.z1, RD + T / 2, H, 'glass')
  box(0, WW - T / 2, RD - T / 2, RD + T / 2, H, 'glass') // muro sur del cuarto
  signs.push({ text: 'OFICINA DEL CEO', x: WW + T / 2 + 0.02, y: 2.45, z: ceoDoor.z0 / 2, facing: Math.PI / 2, size: 0.4, maxWidth: 4.6 })

  // ── Sala de juntas (noreste, de cristal) ──
  const mx = xe0 + EW / 2
  const mz = 3.5
  const meetDoor: Door = { x: xe0, z0: DOOR_Z0, z1: DOOR_Z1 }
  placements.push({ id: 'meet-table', x: mx, z: mz, facing: 0 })
  placements.push({ id: 'whiteboard', x: mx + 2.0, z: 0.12, y: 1.4, facing: 0 })
  windows.push({ x: mx - 2.3, z: -T / 2, w: 2.2, y0: 1.0, y1: 2.4 })
  rugs.push({ x: mx, z: mz + 0.2, w: EW - 0.8, d: 5.4, color: '#2F6F73', accent: '#E9C46A', style: 'diamond' })
  for (const dx of [-1.4, 0, 1.4]) {
    placements.push({ id: 'meet-chair', x: mx + dx, z: mz + 1.7, facing: Math.PI })
    placements.push({ id: 'meet-chair', x: mx + dx, z: mz - 1.7, facing: 0 })
    seats.push({ position: [mx + dx, 0, mz + 1.7], rotation: Math.PI, zone: 'meeting' })
    seats.push({ position: [mx + dx, 0, mz - 1.7], rotation: 0, zone: 'meeting' })
  }
  placements.push({ id: 'plant-tall', x: width - FLUSH - 0.45, z: FLUSH + 0.45, facing: 0 })
  box(xe0 - T / 2, xe0 + T / 2, 0, meetDoor.z0, H, 'glass')
  box(xe0 - T / 2, xe0 + T / 2, meetDoor.z1, RD + T / 2, H, 'glass')
  // Muro sur de la sala = muro de la recepción: sólido, lleva el nombre de la empresa.
  box(xe0 + T / 2, width + T, RD - T / 2, RD + T / 2, H)

  // ── Recepción y entrada (sureste) ──
  const rx = width - 2.5
  placements.push({ id: 'reception-desk', x: rx, z: RD + 2.2, facing: Math.PI })
  placements.push({ id: 'reception-chair', x: rx + 0.6, z: RD + 1.45, facing: Math.PI })
  if (coo) seats.unshift({ position: [rx + 0.6, 0, RD + 1.45], rotation: RECEPTIONIST_FACING, zone: 'reception' })
  placements.push({ id: 'plant-tall', x: width - FLUSH - 0.45, z: RD + 0.9 + 3.3, facing: 0 })
  placements.push({ id: 'plant-tall', x: width - FLUSH - 0.45, z: depth - FLUSH - 0.45, facing: 0 })
  placements.push({ id: 'plant-tall', x: xe0 + 0.7, z: RD + 0.8, facing: 0 })
  signs.push({ text: companyName, x: xe0 + EW / 2, y: 2.45, z: RD + T / 2 + 0.02, facing: 0, size: 0.46, maxWidth: EW - 0.6, metal: true })

  // Plazas de pie en el lobby: se usan cuando ya no quedan escritorios.
  const standing: [number, number, number][] = [
    [xe0 + 1.5, 0, RD + 2.6],
    [xe0 + 2.7, 0, RD + 3.9],
    [xe0 + 1.4, 0, RD + 5.1],
    [xe0 + 7.4, 0, RD + 4.6],
    [xe0 + 4.4, 0, RD + 4.5],
    [xe0 + 1.2, 0, depth - 3.0],
  ]
  for (const p of standing) seats.push({ position: p, rotation: Math.PI * 0.85, zone: 'lobby', standing: true })

  // Con más fondo, la sala de espera: sofá contra el muro este, mesa baja y dos sillones (con menos, estorba al mostrador).
  if (depth >= RD + 9.7) {
    const lz = depth - 3.4
    placements.push({ id: 'sofa', x: width - 1.65, z: lz, facing: -Math.PI / 2 })
    placements.push({ id: 'low-table', x: width - 3.4, z: lz, facing: -Math.PI / 2 })
    placements.push({ id: 'lounge-chair', x: width - 3.4, z: lz - 1.95, facing: 0 })
    placements.push({ id: 'lounge-chair', x: width - 3.4, z: lz + 1.95, facing: Math.PI })
    rugs.push({ x: width - 3.0, z: lz, w: 5.0, d: 5.4, color: '#7E9C8A', accent: '#EFE6D2', style: 'diamond' })
    chill.push({ id: 'chill-wait-sofa', position: [width - 1.65, 0, lz], rotation: -Math.PI / 2, type: 'sofa' })
    chill.push({ id: 'chill-wait-1', position: [width - 3.4, 0, lz - 1.95], rotation: 0, type: 'chair' })
    chill.push({ id: 'chill-wait-2', position: [width - 3.4, 0, lz + 1.95], rotation: Math.PI, type: 'chair' })
  }

  // ── Franja social: café (columna oeste) y lounge ──
  const coffeeZ = RD + 2.9
  placements.push({ id: 'coffee-bar', x: FLUSH + 0.6, z: coffeeZ, facing: Math.PI / 2 })
  // Mesa de billar: quitada por ahora (se agrega después; el prefab 'pool-table' sigue en el catálogo).
  placements.push({ id: 'plant-tall', x: FLUSH + 0.45, z: depth - FLUSH - 0.45, facing: 0 })
  placements.push({ id: 'plant-tall', x: WW - 0.6, z: depth - FLUSH - 0.45, facing: 0 })

  // Lounge en la columna oeste, bajo la oficina del CEO y junto al café: sofá de espaldas al cristal mirando a la mesa baja,
  // un sillón a cada lado y otro al sur. Si hay fondo de sobra se repite hacia abajo.
  const LX = 5.0
  for (let g = 0, zT = RD; zT + 5.4 <= depth - 0.4; g++, zT += 5.8) {
    const tag = String.fromCharCode(97 + g)
    const tz = zT + 2.8
    placements.push({ id: 'sofa', x: LX, z: zT + 1.0, facing: 0 })
    placements.push({ id: 'low-table', x: LX, z: tz, facing: 0 })
    placements.push({ id: 'lounge-chair', x: LX - 2.4, z: tz, facing: Math.PI / 2 })
    placements.push({ id: 'lounge-chair', x: LX + 2.4, z: tz, facing: -Math.PI / 2 })
    placements.push({ id: 'lounge-chair', x: LX, z: zT + 4.5, facing: Math.PI })
    rugs.push({ x: LX, z: zT + 2.9, w: 6.4, d: 5.0, color: g % 2 === 0 ? '#D9A441' : '#B5573A', accent: g % 2 === 0 ? '#6B2D3A' : '#F2E2C4', style: g % 2 === 0 ? 'diamond' : 'stripes' })
    chill.push({ id: `chill-sofa-${tag}`, position: [LX, 0, zT + 1.0], rotation: 0, type: 'sofa' })
    chill.push({ id: `chill-chair-${tag}1`, position: [LX - 2.4, 0, tz], rotation: Math.PI / 2, type: 'chair' })
    chill.push({ id: `chill-chair-${tag}2`, position: [LX + 2.4, 0, tz], rotation: -Math.PI / 2, type: 'chair' })
    chill.push({ id: `chill-chair-${tag}3`, position: [LX, 0, zT + 4.5], rotation: Math.PI, type: 'chair' })
  }
  // El sur del área de trabajo: plantas, sin estorbar el paso.
  placements.push({ id: 'plant-tall', x: xc0 + 0.6, z: depth - FLUSH - 0.45, facing: 0 })
  placements.push({ id: 'plant-tall', x: xe0 - 0.6, z: depth - FLUSH - 0.45, facing: 0 })
  placements.push({ id: 'plant-tall', x: xe0 - 0.6, z: RD + 0.7, facing: 0 })

  // ── Paredes exteriores ──
  // Muro norte, partido alrededor de las ventanas (la de la oficina del CEO y la de la sala de juntas).
  const wins = [...windows].sort((a, b) => a.x - b.x)
  let nx = -T
  for (const w of wins) {
    box(nx, w.x - w.w / 2, -T, 0, H)
    box(w.x - w.w / 2, w.x + w.w / 2, -T, 0, w.y0) // antepecho
    box(w.x - w.w / 2, w.x + w.w / 2, -T, 0, H - w.y1, 'solid', w.y1) // dintel
    nx = w.x + w.w / 2
  }
  box(nx, width + T, -T, 0, H)
  box(-T, 0, 0, depth, H) // oeste
  box(width, width + T, 0, RD + T / 2, H) // este de la sala de juntas
  box(width, width + T, RD + T / 2, depth, 0.56, 'knee') // este: muro bajo
  // Frente: muro bajo con una abertura de entrada.
  const gap0 = xe0 + 1.2
  const gap1 = xe0 + 4.8
  box(-T, gap0, depth, depth + T, 0.56, 'knee')
  box(gap1, width + T, depth, depth + T, 0.56, 'knee')

  const boardZone = { x0: coworkCenterX - BOARD_ZONE_W / 2, x1: coworkCenterX + BOARD_ZONE_W / 2, z0: 0.8, z1: 2.4 }
  const interactions: Interaction[] = [
    { id: 'board', kind: 'board', x: (boardZone.x0 + boardZone.x1) / 2, z: (boardZone.z0 + boardZone.z1) / 2, radius: 2.4, label: 'Ver tablero de tareas' },
  ]
  // La silla de la persona usuaria: se sienta en su escritorio (y en las de visita).
  interactions.push({ id: 'sit:ceo', kind: 'sit', x: ceoSeat.position[0], z: ceoSeat.position[2], radius: 1.1, label: 'Sentarte en tu escritorio', seat: { x: ceoSeat.position[0], z: ceoSeat.position[2], rotation: ceoSeat.rotation } })
  visitors.forEach((v, i) => interactions.push({ id: `sit:ceo-visitor-${i}`, kind: 'sit', x: v.position[0], z: v.position[2], radius: 1.1, label: 'Sentarte', seat: { x: v.position[0], z: v.position[2], rotation: v.rotation } }))
  // Lado de las visitas del mostrador (al sur, hacia la entrada).
  if (coo) interactions.push({ id: 'assistant', kind: 'talk', x: rx, z: RD + 4.1, radius: 4, label: 'Hablar con Assistant', target: 'coo' })

  return {
    seatCount: n,
    modules,
    cols,
    rows,
    width,
    depth,
    wallHeight: H,
    placements,
    rugs,
    seats,
    islands,
    chill,
    walls,
    windows,
    signs,
    spawn: [(gap0 + gap1) / 2, 0, depth - 1.5],
    ceo: { x0: 0, x1: WW, z0: 0, z1: RD, door: ceoDoor, seat: ceoSeat, visitors },
    meeting: { x0: xe0, x1: width, z0: 0, z1: RD, door: meetDoor },
    board: { x: coworkCenterX, width: Math.min(7.2, Math.max(4.6, coworkW)) },
    boardZone,
    interactions,
    center: [width / 2, depth / 2],
    zones: {
      cowork: { x: coworkX0, z: TOP, w: coworkW, d: (rows - 1) * ROW_PITCH + ISLE_D },
      coffee: { x: 0.2, z: RD + 1.3, w: 2.2, d: 3.2 },
      chill: { x: 0.2, z: RD, w: WW, d: depth - RD },
      lounge: { x: 1.8, z: RD + 0.4, w: WW - 2.2, d: depth - RD - 0.8 },
      meeting: { x: xe0, z: 0, w: EW, d: RD },
      reception: { x: xe0, z: RD, w: EW, d: depth - RD },
    },
  }
}
