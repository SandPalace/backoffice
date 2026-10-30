'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Epic, FilesEvent, Lead, Session, Sprint, StorageStatus, Story, SystemAgent, Task, Team, Workspace } from './types'

// Same origin: in the browser the API is this page's own `/api/*` (next.config.mjs proxies it to the local server), so
// the session cookie is first-party and no browser (Cowork's embedded one included) has to call another port.
export const SERVER = process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? (typeof window !== 'undefined' ? '' : `http://127.0.0.1:${process.env.NEXT_PUBLIC_BACKOFFICE_PORT ?? process.env.NEXT_PUBLIC_AGENTOS_PORT ?? 4780}`) // AGENTOS: rename compat

/** fetch to the Back Office server: sends the session cookie and tells the auth gate when the session is gone. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(input, { credentials: 'include', ...init })
  if (r.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('backoffice:auth'))
  return r
}
export const DEFAULT_WORKSPACE = 'default'
const LS_KEY = 'backoffice.workspace'

export type Conn = 'connecting' | 'live' | 'down'

// Workspace the REST helpers (post/send/get) talk to. The provider keeps it in sync with the selected one.
let currentWorkspace = DEFAULT_WORKSPACE
export const getCurrentWorkspace = () => currentWorkspace

/** Adds ?workspace=<id> to an API path (unless it already has one). */
export const withWorkspace = (path: string, ws: string = currentWorkspace) =>
  path.includes('workspace=') ? path : `${path}${path.includes('?') ? '&' : '?'}workspace=${encodeURIComponent(ws)}`

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [item, ...list]
  const next = list.slice()
  next[i] = item
  return next
}

async function request(method: string, path: string, body?: unknown, opts: { scoped?: boolean } = {}) {
  const url = `${SERVER}${opts.scoped === false ? path : withWorkspace(path)}`
  const r = await apiFetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!r.ok) throw new Error(json?.message ?? json?.error ?? `HTTP ${r.status}`)
  return json
}

export const post = (path: string, body: unknown = {}) => request('POST', path, body)
export const send = (method: 'PATCH' | 'DELETE', path: string, body?: unknown) => request(method, path, body)
export const getJson = (path: string) => request('GET', path)
export const put = (path: string, body: unknown) => request('PUT', path, body)

export interface BackOfficeState {
  sessions: Session[]
  tasks: Task[]
  leads: Lead[]
  epics: Epic[]
  stories: Story[]
  sprints: Sprint[]
  /** Increments on every WhatsApp SSE event (`wa_message` / `wa_draft`): components refetch when it changes. */
  waTick: number
  /** Increments on every Canvas SSE event (`canvas`): boards and the detail refetch when it changes. */
  canvasTick: number
  teams: Team[]
  coo: SystemAgent | null
  conn: Conn
  /** false until the first snapshot of the current workspace arrived */
  ready: boolean
  workspaces: Workspace[]
  workspace: Workspace | null
  workspaceId: string
  setWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<Workspace>
  renameWorkspace: (id: string, name: string) => Promise<void>
  archiveWorkspace: (id: string, force?: boolean) => Promise<void>
  storage: StorageStatus | null
  storageError: string | null
  refreshStorage: () => Promise<void>
  /** Subscribe to live `files` events of the current workspace. Returns the unsubscribe function. */
  subscribeFiles: (fn: (e: FilesEvent) => void) => () => void
}

export const BackOfficeContext = createContext<BackOfficeState | null>(null)

// Live state from the local server: one snapshot on connect, then SSE changes. Lives in BackOfficeProvider so
// every page and the header share one connection and one selected workspace.
export function useBackOfficeState(): BackOfficeState {
  const [workspaceId, setWorkspaceId] = useState(DEFAULT_WORKSPACE)
  const [hydrated, setHydrated] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [epics, setEpics] = useState<Epic[]>([])
  const [stories, setStories] = useState<Story[]>([])
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [waTick, setWaTick] = useState(0)
  const [canvasTick, setCanvasTick] = useState(0)
  const [coo, setCoo] = useState<SystemAgent | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [conn, setConn] = useState<Conn>('connecting')
  const [ready, setReady] = useState(false)
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const fileListeners = useRef(new Set<(e: FilesEvent) => void>())
  const subscribeFiles = useCallback((fn: (e: FilesEvent) => void) => {
    fileListeners.current.add(fn)
    return () => { fileListeners.current.delete(fn) }
  }, [])

  currentWorkspace = workspaceId

  // Restore the persisted workspace before opening the first stream.
  useEffect(() => {
    // One Back Office = one company (2026-10-29): the web always shows `default`. Old `?ws=` links and a remembered
    // project from a multi-project install are ignored; their data is brought in with scripts/import-agentos.mjs.
    try { localStorage.removeItem(LS_KEY) } catch { /* storage blocked */ }
    setHydrated(true)
  }, [])

  const setWorkspace = useCallback((id: string) => {
    currentWorkspace = id
    try { localStorage.setItem(LS_KEY, id) } catch { /* ignore */ }
    setWorkspaceId(id)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    setReady(false)
    setSessions([]); setTasks([]); setLeads([]); setTeams([]); setCoo(null); setEpics([]); setStories([]); setSprints([])
    const fallbackIfGone = async () => {
      try {
        const list: Workspace[] = await (await apiFetch(`${SERVER}/api/workspaces`)).json()
        setWorkspaces(list)
        if (!list.some((w) => w.id === workspaceId)) setWorkspace(DEFAULT_WORKSPACE)
      } catch { /* server down: keep retrying */ }
    }
    const open = () => {
      const es = new EventSource(`${SERVER}/api/stream?workspace=${encodeURIComponent(workspaceId)}`, { withCredentials: true })
      esRef.current = es
      const on = (name: string, fn: (d: any) => void) => es.addEventListener(name, (e) => fn(JSON.parse((e as MessageEvent).data)))
      on('snapshot', (d) => {
        if (d.workspaces) {
          setWorkspaces(d.workspaces)
          if (!d.workspaces.some((w: Workspace) => w.id === workspaceId)) { setWorkspace(DEFAULT_WORKSPACE); return }
        }
        setSessions(d.sessions)
        setTasks(d.tasks)
        setLeads(d.leads ?? [])
        setEpics(d.epics ?? [])
        setStories(d.stories ?? [])
        setSprints(d.sprints ?? [])
        setTeams(d.teams ?? [])
        setCoo(d.system?.coo ?? null)
        setConn('live')
        setReady(true)
      })
      on('session', (d) => setSessions((l) => upsert(l, d)))
      on('teams', (d) => setTeams(d))
      on('system', (d) => setCoo(d.coo ?? null))
      on('task', (d) => setTasks((l) => upsert(l, d)))
      on('task_deleted', (d) => setTasks((l) => l.filter((x) => x.id !== d.id)))
      on('lead', (d) => setLeads((l) => upsert(l, d)))
      on('lead_deleted', (d) => setLeads((l) => l.filter((x) => x.id !== d.id)))
      on('epic', (d) => setEpics((l) => upsert(l, d)))
      on('epic_deleted', (d) => setEpics((l) => l.filter((x) => x.id !== d.id)))
      on('story', (d) => setStories((l) => upsert(l, d)))
      on('story_deleted', (d) => setStories((l) => l.filter((x) => x.id !== d.id)))
      on('sprint', (d) => setSprints((l) => upsert(l, d)))
      on('sprint_deleted', (d) => setSprints((l) => l.filter((x) => x.id !== d.id)))
      on('wa_message', () => setWaTick((n) => n + 1))
      on('wa_draft', () => setWaTick((n) => n + 1))
      on('canvas', () => setCanvasTick((n) => n + 1))
      on('files', (d: FilesEvent) => fileListeners.current.forEach((fn) => fn(d)))
      on('workspaces', (d) => {
        const list: Workspace[] = Array.isArray(d) ? d : d?.workspaces ?? []
        setWorkspaces(list)
        if (list.length && !list.some((w) => w.id === workspaceId)) setWorkspace(DEFAULT_WORKSPACE)
      })
      es.onerror = () => {
        setConn('down')
        es.close()
        if (!closed) {
          fallbackIfGone()
          retry = setTimeout(open, 2000)
        }
      }
    }
    open()
    return () => {
      closed = true
      clearTimeout(retry)
      esRef.current?.close()
    }
  }, [workspaceId, hydrated, setWorkspace])

  const refreshStorage = useCallback(async () => {
    try {
      setStorage(await request('GET', '/api/storage/status', undefined, { scoped: false }))
      setStorageError(null)
    } catch (e) {
      setStorageError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    refreshStorage()
    const t = setInterval(refreshStorage, 10000)
    return () => clearInterval(t)
  }, [refreshStorage])

  const reloadWorkspaces = useCallback(async () => {
    try { setWorkspaces(await request('GET', '/api/workspaces', undefined, { scoped: false })) } catch { /* SSE will catch up */ }
  }, [])
  const createWorkspace = useCallback(async (name: string) => {
    const w: Workspace = await request('POST', '/api/workspaces', { name }, { scoped: false })
    await reloadWorkspaces()
    return w
  }, [reloadWorkspaces])
  const renameWorkspace = useCallback(async (id: string, name: string) => {
    await request('PATCH', `/api/workspaces/${encodeURIComponent(id)}`, { name }, { scoped: false })
    await reloadWorkspaces()
  }, [reloadWorkspaces])
  const archiveWorkspace = useCallback(async (id: string, force = false) => {
    await request('DELETE', `/api/workspaces/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, undefined, { scoped: false })
    if (id === currentWorkspace) setWorkspace(DEFAULT_WORKSPACE)
    await reloadWorkspaces()
  }, [reloadWorkspaces, setWorkspace])

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? null
  return { sessions, tasks, leads, epics, stories, sprints, waTick, canvasTick, teams, coo, conn, ready, workspaces, workspace, workspaceId, setWorkspace, createWorkspace, renameWorkspace, archiveWorkspace, storage, storageError, refreshStorage, subscribeFiles }
}

export function useBackOffice(): BackOfficeState {
  const ctx = useContext(BackOfficeContext)
  if (!ctx) throw new Error('useBackOffice must be used inside <BackOfficeProvider>')
  return ctx
}
