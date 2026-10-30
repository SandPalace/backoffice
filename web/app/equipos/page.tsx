'use client'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Header from '@/components/Header'
import Modal from '@/components/Modal'
import NameSuggest from '@/components/NameSuggest'
import AgentDefEditor, { GlobalAgentDefs } from '@/components/AgentDefEditor'
import { AgentCanvasSection } from '@/components/CanvasBoard'
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons'
import { AVATAR_PALETTES } from '@/components/office/officeLayout'
import { COO_AGENT, ROSTERS, findAgent } from '@/lib/roster'
import { sessionLink } from '@/lib/claude'
import { getJson, post, send, useBackOffice } from '@/lib/useBackOffice'
import type { Team, TeamMember } from '@/lib/types'

const AvatarGallery = dynamic(() => import('@/components/AvatarGallery'), { ssr: false })
const MAX_CONTEXT = 8000

type DesktopSession = { id: string; title: string; cwd: string; lastActivityAt: number | null; archived: boolean; surface?: 'code' | 'cowork'; inProject?: boolean; linkedTo?: { project: string | null; team: string | null; agent: string }[] }

const shortFolder = (p: string) => p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')
function ago(ms: number | null): string {
  if (!ms) return ''
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (m < 1) return 'hace un momento'
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d < 30 ? `hace ${d} d` : `hace ${Math.round(d / 30)} mes${Math.round(d / 30) === 1 ? '' : 'es'}`
}

// Sesiones de Claude Desktop (Code y Cowork), leídas una vez por página: las usan el selector y la línea que identifica cada campo.
let desktopCache: Promise<{ available: boolean; sessions: DesktopSession[] }> | null = null
const desktopSessions = (): Promise<{ available: boolean; sessions: DesktopSession[] }> =>
  (desktopCache ??= getJson('/api/desktop/code-sessions').catch((e: unknown) => { desktopCache = null; throw e }))
const folderName = (cwd: string) => (cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd : '')

function SessionPicker({ onPick, onClose, current, taken }: { onPick: (id: string) => void; onClose: () => void; current: string; taken: string[] }) {
  const [tab, setTab] = useState<'claude' | 'codex'>(() => (sessionLink(current)?.kind === 'codex' ? 'codex' : 'claude'))
  const [surface, setSurface] = useState<'code' | 'cowork'>(() => (sessionLink(current)?.kind === 'cowork' ? 'cowork' : 'code'))
  const [data, setData] = useState<{ available: boolean; sessions: DesktopSession[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [archived, setArchived] = useState(false)
  const [showLinked, setShowLinked] = useState(false)
  const codex = tab === 'codex'
  useEffect(() => {
    let alive = true
    setData(null); setErr(null)
    if (!codex) desktopCache = null // al abrir el selector, lista fresca
    const load: Promise<{ available: boolean; sessions: DesktopSession[] }> = codex ? getJson('/api/codex/sessions') : desktopSessions()
    load.then((d) => { if (alive) setData(d) }).catch((e) => { if (alive) setErr(e.message || 'No pude leer tus sesiones') })
    return () => { alive = false }
  }, [codex])
  // Lo que se guarda en el campo: Codex usa el enlace completo para que coincida con lo ligado.
  // Cowork: «cowork:local_…» (Desktop no abre tareas de Cowork por id; así la oficina sabe qué decir).
  const refOf = (x: DesktopSession) => (codex ? `codex://threads/${x.id}` : x.surface === 'cowork' ? `cowork:${x.id}` : x.id)
  const inSurface = (x: DesktopSession) => codex || (x.surface ?? 'code') === surface
  const count = (k: 'code' | 'cowork') => (data?.sessions ?? []).filter((x) => (archived || !x.archived) && (x.surface ?? 'code') === k).length
  const needle = q.trim().toLowerCase()
  // Ya conectada = ligada a otro agente (guardado en cualquier proyecto, o en este equipo sin guardar). La del propio campo no cuenta.
  const busy = (x: DesktopSession) => refOf(x) !== current.trim() && (taken.includes(refOf(x)) || !!x.linkedTo?.length)
  const hiddenLinked = (data?.sessions ?? []).filter((x) => inSurface(x) && (archived || !x.archived) && busy(x)).length
  const shown = (data?.sessions ?? []).filter((x) => inSurface(x) && (archived || !x.archived) && (showLinked || !busy(x)) && (!needle || `${x.title} ${shortFolder(x.cwd)}`.toLowerCase().includes(needle)))
  // Una sección por carpeta (su nombre de subtítulo); primero las carpetas del proyecto actual, luego por actividad más reciente.
  const groups = useMemo(() => {
    const by = new Map<string, { key: string; name: string; path: string; inProject: boolean; last: number; items: DesktopSession[] }>()
    for (const x of shown) {
      const path = shortFolder(x.cwd || '')
      const key = x.cwd || ''
      const name = !x.cwd ? 'Sin carpeta' : path === '~' ? 'Inicio (~)' : x.cwd.split(/[\\/]/).filter(Boolean).pop() || path
      const g = by.get(key) ?? { key, name, path, inProject: false, last: 0, items: [] }
      g.items.push(x)
      g.inProject ||= !!x.inProject
      g.last = Math.max(g.last, x.lastActivityAt ?? 0)
      by.set(key, g)
    }
    return [...by.values()].sort((a, b) => Number(b.inProject) - Number(a.inProject) || b.last - a.last)
  }, [shown])
  return (
    <Modal title="Elegir de mis sesiones" onClose={onClose} wide initialFocus="input[type=search]">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-bold text-ink">Elegir de mis sesiones</h2>
        <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:bg-bg">Cerrar</button>
      </div>
      <div className="flex flex-col items-center border-b border-line px-4 py-3">
        <div role="tablist" aria-label="Aplicación" className="inline-flex rounded-full border border-line bg-bg p-1">
          {(['claude', 'codex'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === t ? 'bg-surface text-ink ring-1 ring-line' : 'text-muted hover:text-ink'}`}>
              {t === 'claude' ? <ClaudeIcon /> : <CodexIcon />}{t === 'claude' ? 'Claude' : 'Codex'}
            </button>
          ))}
        </div>
        {!codex && (
          <div role="tablist" aria-label="Tipo de sesión de Claude" className="mt-2 flex justify-center gap-1">
            {(['code', 'cowork'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={surface === k} onClick={() => setSurface(k)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${surface === k ? (k === 'cowork' ? 'bg-purple-soft text-purple' : 'bg-blue-soft text-blue') : 'text-muted hover:text-ink'}`}>
                {k === 'code' ? 'Claude Code' : 'Cowork'}{data ? ` (${count(k)})` : ''}
              </button>
            ))}
          </div>
        )}
        {!codex && surface === 'cowork' && <p className="mt-2 text-center text-[11px] text-muted">Claude Desktop no abre tareas de Cowork por enlace: al hablar con el agente se trae Claude al frente y te decimos qué tarea abrir.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título o carpeta" aria-label="Buscar sesión" className="min-w-[200px] flex-1 rounded-sm border border-line bg-surface px-3 py-1 text-sm text-ink outline-none focus:border-blue" />
        <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={showLinked} onChange={(e) => setShowLinked(e.target.checked)} /> Mostrar conectadas{hiddenLinked ? ` (${hiddenLinked})` : ''}</label>
        <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Mostrar archivadas</label>
      </div>
      <div className="min-h-[160px] overflow-y-auto px-4 py-3">
        {err ? <p className="text-sm text-muted">{err}</p>
          : !data ? <p className="text-sm text-muted">Buscando tus sesiones…</p>
          : !data.available && codex ? <p className="text-sm text-muted">No encontré conversaciones de Codex en esta computadora.</p>
          : !data.available ? <p className="text-sm text-muted">No encontré sesiones de Claude Desktop en esta computadora. Las sesiones en la nube (cse_… / session_…) y los chats se ligan pegando su enlace en el campo.</p>
          : !groups.length ? <p className="text-sm text-muted">{data.sessions.length ? 'Ninguna sesión coincide con tu búsqueda.' : codex ? 'Todavía no tienes conversaciones de Codex.' : 'Todavía no tienes sesiones de Code ni de Cowork en Claude Desktop.'}</p>
          : groups.map((g) => (
            <section key={g.key} className="mb-4">
              <h3 className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-bold text-ink">{g.name}</span>
                {g.inProject && <span className="rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-semibold text-blue">Este proyecto</span>}
                {g.path && <span className="truncate text-[11px] text-muted">{g.path}</span>}
              </h3>
              <ul className="flex flex-col gap-1">
                {g.items.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 rounded-sm border border-line bg-surface px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {!codex && x.surface && <span className={`mr-2 rounded-full px-2 py-0.5 align-[1px] text-[10px] font-semibold ${x.surface === 'cowork' ? 'bg-purple-soft text-purple' : 'bg-blue-soft text-blue'}`}>{x.surface === 'cowork' ? 'Cowork' : 'Code'}</span>}
                        {x.title || 'Sin título'}{x.archived && <span className="ml-2 rounded-full bg-blue-soft px-2 py-0.5 text-[10px] font-semibold text-muted">Archivada</span>}</div>
                      <div className="truncate text-[11px] text-muted">
                        {x.lastActivityAt ? ago(x.lastActivityAt) : ''}
                        {busy(x) && <span className="ml-1 font-semibold text-amber">· Ya conectada a {x.linkedTo?.length ? x.linkedTo.map((l) => (l.agent === 'coo' ? 'Assistant' : `${findAgent(l.agent)?.name ?? l.agent}${l.team ? ` (${l.team}${l.project ? ` · ${l.project}` : ''})` : ''}`)).join(', ') : 'otro agente de este equipo'}</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => onPick(refOf(x))} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-blue hover:bg-bg">Ligar</button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </Modal>
  )
}

function SessionField({ id, label, value, onChange, emptyHint, taken = [] }: { id: string; label: string; value: string; onChange: (v: string) => void; emptyHint: string; taken?: string[] }) {
  const link = sessionLink(value)
  const [pick, setPick] = useState(false)
  // Qué sesión es: tipo, título y carpeta (sesiones locales de Desktop). Un id local pegado a mano que resulta de Cowork se marca como tal.
  const [info, setInfo] = useState<DesktopSession | null>(null)
  const localId = value.trim().replace(/^cowork:/, '')
  useEffect(() => {
    setInfo(null)
    if (!/^local_[A-Za-z0-9-]+$/.test(localId)) return
    let alive = true
    desktopSessions().then((d) => {
      const x = d.sessions.find((s) => s.id === localId) ?? null
      if (!alive) return
      setInfo(x)
      if (x?.surface === 'cowork' && value.trim() === localId) onChange(`cowork:${localId}`)
    }).catch(() => {})
    return () => { alive = false }
  }, [localId])
  const hint = !value.trim() ? emptyHint
    : !link ? 'No la reconozco'
    : link.kind === 'codex' ? 'Abre la conversación en Codex'
    : link.kind === 'cowork' ? 'Tarea de Cowork: Claude Desktop no la abre por enlace; «Probar» trae Claude al frente y la eliges en Cowork'
    : link.kind === 'code' ? (localId.startsWith('local_') ? 'Abre la sesión de Claude Code en Desktop' : 'Abre una sesión de Claude Code (nube)')
    : link.kind === 'chat' ? 'Abre un chat' : 'Abre un proyecto'
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">Conversación</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Pega el enlace o id de la sesión (ej. https://claude.ai/code/cse_… )"
          maxLength={300}
          className="min-w-[220px] flex-1 rounded-sm border border-line px-3 py-1 text-sm outline-none focus:border-blue"
        />
        <button type="button" onClick={() => setPick(true)} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-bg">Elegir de mis sesiones</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        {info && (
          <span className="flex min-w-0 items-center gap-1.5 text-ink">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${info.surface === 'cowork' ? 'bg-purple-soft text-purple' : 'bg-blue-soft text-blue'}`}>{info.surface === 'cowork' ? 'Cowork' : 'Code'}</span>
            <span className="truncate font-semibold">{info.title || 'Sin título'}</span>
            {info.cwd && <span className="truncate text-muted" title={info.cwd}>· {folderName(info.cwd)}</span>}
          </span>
        )}
        <span>{hint}</span>
        {link && <a href={link.url} className="rounded-full border border-line px-2 py-0.5 font-semibold text-blue hover:bg-bg">Probar</a>}
      </div>
      {pick && <SessionPicker current={value} taken={taken} onClose={() => setPick(false)} onPick={(sid) => { onChange(sid); setPick(false) }} />}
    </div>
  )
}

type Draft = { id: string | null; name: string; members: TeamMember[] }
const blank = (): Draft => ({ id: null, name: '', members: [] })
const fromTeam = (t: Team): Draft => ({ id: t.id, name: t.name, members: t.members.map((m) => ({ ...m })) })

export default function EquiposPage() {
  const { teams, coo, conn, ready, workspace, workspaceId } = useBackOffice()
  const [draft, setDraft] = useState<Draft>(blank())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickingAgents, setPickingAgents] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [picking, setPicking] = useState<string | null>(null) // agent_id que está eligiendo avatar
  const [editCoo, setEditCoo] = useState(false)
  const [cooDraft, setCooDraft] = useState({ display_name: '', avatar: null as number | null, context: '', session_ref: null as string | null })
  const [cooLoaded, setCooLoaded] = useState(false)
  const [cooSaved, setCooSaved] = useState(false)
  // Switching workspace starts the editor over: the teams and the COO belong to the workspace.
  useEffect(() => {
    setLoaded(false); setCooLoaded(false); setDraft(blank()); setEditCoo(false); setError(null); setPicking(null)
    setCooDraft({ display_name: '', avatar: null, context: '', session_ref: null })
  }, [workspaceId])
  useEffect(() => {
    if (cooLoaded || !coo || !ready) return
    setCooLoaded(true)
    setCooDraft({ display_name: coo.display_name, avatar: coo.avatar, context: coo.context, session_ref: coo.session_ref ?? null })
  }, [coo, cooLoaded, ready])
  const cooDirty = !!coo && (cooDraft.display_name !== coo.display_name || cooDraft.avatar !== coo.avatar || cooDraft.context !== coo.context || (cooDraft.session_ref ?? '') !== (coo.session_ref ?? ''))
  const cooFace = cooDraft.avatar ?? COO_AGENT.face ?? 12
  const saveCoo = () =>
    run(async () => {
      await send('PATCH', '/api/system/coo', cooDraft)
      setCooSaved(true)
      setTimeout(() => setCooSaved(false), 2000)
    })

  // Al llegar los equipos del servidor, abre el primero. Después el borrador es de la persona.
  useEffect(() => {
    if (loaded || conn !== 'live' || !ready) return
    setLoaded(true)
    const t = teams[0]
    if (t) setDraft(fromTeam(t))
  }, [teams, conn, loaded, ready])

  const saved = draft.id ? teams.find((t) => t.id === draft.id) : null
  const dirty = useMemo(() => {
    if (!saved) return draft.name.trim() !== '' || draft.members.length > 0
    return JSON.stringify(fromTeam(saved)) !== JSON.stringify(draft)
  }, [saved, draft])

  const inTeam = new Set(draft.members.map((m) => m.agent_id))
  const toggle = (id: string) =>
    setDraft((d) => ({ ...d, members: inTeam.has(id) ? d.members.filter((m) => m.agent_id !== id) : [...d.members, { agent_id: id, display_name: '', avatar: null, context: '', session_ref: null }] }))
  const addGroup = (ids: string[]) =>
    setDraft((d) => ({ ...d, members: [...d.members, ...ids.filter((id) => !d.members.some((m) => m.agent_id === id)).map((id) => ({ agent_id: id, display_name: '', avatar: null, context: '', session_ref: null }))] }))
  const setField = (id: string, patch: Partial<TeamMember>) =>
    setDraft((d) => ({ ...d, members: d.members.map((m) => (m.agent_id === id ? { ...m, ...patch } : m)) }))

  const run = async (fn: () => Promise<Team | void>) => {
    setSaving(true)
    setError(null)
    try {
      const t = await fn()
      if (t) setDraft(fromTeam(t))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const save = () =>
    run(() => (draft.id ? send('PATCH', `/api/teams/${draft.id}`, { name: draft.name, members: draft.members }) : post('/api/teams', { name: draft.name, members: draft.members })))
  const remove = () =>
    run(async () => {
      if (!draft.id || !window.confirm(`¿Borrar el equipo «${draft.name}»?`)) return
      await send('DELETE', `/api/teams/${draft.id}`)
      setDraft(blank())
    })

  // Selector de agentes por grupo del roster: en línea al crear un equipo, en un modal al editarlo.
  const agentPicker = (
    <>
      {ROSTERS.filter((g) => !g.system).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })).map((g) => (
        <div key={g.id} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-muted">{g.name}</div>
            {g.agents.some((a) => !inTeam.has(a.id)) && (
              <button onClick={() => addGroup(g.agents.map((a) => a.id))} className="text-xs font-semibold text-blue hover:underline">Agregar todos</button>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.agents.map((a) => {
              const on = inTeam.has(a.id)
              return (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-3 rounded-sm border px-3 py-2 text-left ${on ? 'border-blue bg-blue-soft' : 'border-line hover:bg-bg'}`}
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{a.name}</span>
                    <span className="block truncate text-xs text-muted">{a.role}</span>
                  </span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-sm border text-[11px] font-bold ${on ? 'border-blue bg-blue text-white' : 'border-line text-transparent'}`}>✓</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
  // Al cambiar de equipo se cierra el selector de agentes.
  useEffect(() => { setPickingAgents(false) }, [draft.id])
  const faceOf = (m: TeamMember) => m.avatar ?? findAgent(m.agent_id)?.face ?? 0
  const canSave = draft.name.trim() !== '' && dirty && conn === 'live' && !saving

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Espacio de trabajo</div>
          <h1 className="text-xl font-extrabold tracking-tight">Equipos · {workspace?.name ?? workspaceId}</h1>
          {ready && teams.length === 0 && <p className="mt-1 text-xs text-muted">Este espacio de trabajo todavía no tiene equipos. Crea el primero con «+ Nuevo equipo» en la barra de la izquierda. Assistant es la misma en todos tus proyectos.</p>}
        </div>
        {/* Equipo nuevo: «Crear equipo» va en el encabezado de la página */}
        {!editCoo && !draft.id && (
          <button disabled={!canSave} onClick={save} title={!draft.name.trim() ? 'Ponle nombre al equipo primero' : undefined} className="h-9 rounded-full bg-blue px-5 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? 'Guardando…' : 'Crear equipo'}
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        <aside className="card flex flex-col gap-1 p-3 md:self-start">
          <div className="label px-2 pb-2 pt-1">Siempre presente</div>
          <button
            onClick={() => { setEditCoo(true); setError(null) }}
            className={`flex items-center gap-3 rounded-sm px-3 py-2 text-left ${editCoo ? 'bg-blue-soft text-blue' : 'hover:bg-bg'}`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: AVATAR_PALETTES[cooFace].shirt }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{(coo?.display_name || COO_AGENT.name)}</span>
              <span className="block truncate text-xs font-normal text-muted">Puente y guía de Back Office</span>
            </span>
          </button>
          <div className="label px-2 pb-2 pt-3">Equipos</div>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => { setDraft(fromTeam(t)); setEditCoo(false); setError(null) }}
              className={`flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm font-semibold ${!editCoo && draft.id === t.id ? 'bg-blue-soft text-blue' : 'hover:bg-bg'}`}
            >
              <span className="truncate">{t.name}</span>
            </button>
          ))}
          <button
            onClick={() => { setDraft(blank()); setEditCoo(false); setError(null) }}
            className={`mt-1 rounded-sm border border-dashed border-line px-3 py-2 text-left text-sm font-semibold text-muted hover:text-ink ${!editCoo && !draft.id ? 'bg-bg text-ink' : ''}`}
          >
            + Nuevo equipo
          </button>
        </aside>

        {editCoo ? (
          <section className="flex flex-col gap-4">
            <div className="card flex flex-col gap-3 p-5">
              <div className="label">Assistant · recepción, puente y guía de Back Office</div>
              <p className="text-xs leading-relaxed text-muted">
                Assistant es quien te recibe en la recepción de la oficina y no pertenece a ningún equipo. Es la misma en todos tus proyectos: su nombre, avatar, contexto y conversación valen para todos, y en cada uno ve los equipos y tareas de ese proyecto. Conoce el roster completo, ve las tareas y el estado de los agentes de tus equipos activos y te guía por Back Office. Aquí le pones nombre, avatar y contexto.
              </p>
            </div>
            <div className="card flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setPicking('coo')} aria-label="Cambiar avatar de Assistant" title="Cambiar avatar" className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-line bg-bg hover:border-blue">
                  <img src={`/faces/face-${cooFace}.png`} alt="" className="h-full w-full object-cover" style={{ imageRendering: 'pixelated' }} />
                </button>
                <input
                  id="coo-name"
                  aria-label="Nombre de Assistant"
                  value={cooDraft.display_name}
                  onChange={(e) => setCooDraft((d) => ({ ...d, display_name: e.target.value }))}
                  placeholder="Ponle un nombre (ej. Rafa)"
                  maxLength={40}
                  className="min-w-[200px] flex-1 rounded-sm border border-line px-3 py-1.5 text-sm outline-none focus:border-blue sm:max-w-[320px]"
                />
                <NameSuggest face={cooFace} label="Assistant" current={cooDraft.display_name} taken={draft.members.map((x) => x.display_name)} onPick={(n) => setCooDraft((d) => ({ ...d, display_name: n }))} />
              </div>
              <SessionField id="coo-session" label="Assistant" taken={draft.members.map((x) => x.session_ref ?? '').filter(Boolean)} emptyHint="vacía, la E abre una sesión nueva de Claude Code con «Hola, ahora eres una asistente…»; envíala y pega aquí su enlace." value={cooDraft.session_ref ?? ''} onChange={(v) => setCooDraft((d) => ({ ...d, session_ref: v || null }))} />
              <textarea
                id="coo-context"
                aria-label="Contexto de Assistant"
                value={cooDraft.context}
                onChange={(e) => setCooDraft((d) => ({ ...d, context: e.target.value }))}
                rows={6}
                maxLength={MAX_CONTEXT}
                placeholder="Ej. Háblame de tú y sé breve. Mi negocio vende casas en San Nicolás; avísame primero lo que esté bloqueado."
                className="resize-y rounded-sm border border-line px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue"
              />
              <div className="text-right font-mono text-[11px] text-muted">{cooDraft.context.length} / {MAX_CONTEXT}</div>
              <AgentCanvasSection agentId="coo" name={coo?.display_name || COO_AGENT.name} />
            </div>
            {error && <div className="card border-red p-3 text-sm text-red" role="alert">{error}</div>}
            <div className="flex items-center gap-3">
              <button disabled={!cooDirty || saving || conn !== 'live'} onClick={saveCoo} className="rounded-full bg-blue px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              {cooSaved && <span className="text-xs font-semibold text-teal">Guardado</span>}
            </div>
          </section>
        ) : (
        <section className="flex flex-col gap-4">
          <div className="card flex flex-col gap-3 p-5">
            <label className="label" htmlFor="team-name">Nombre del equipo</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="team-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Ej. Marketing de la inmobiliaria"
                maxLength={80}
                className="min-w-[200px] flex-1 rounded-sm border border-line px-3 py-2 text-sm outline-none focus:border-blue"
              />
              {draft.id && (
                <>
                  <button type="button" onClick={() => setPickingAgents(true)} className="h-9 rounded-full border border-line bg-surface px-4 text-xs font-semibold hover:bg-bg">
                    Editar agentes ({draft.members.length})
                  </button>
                  <button disabled={!canSave} onClick={save} className="h-9 rounded-full bg-blue px-5 text-sm font-semibold text-white disabled:opacity-40">
                    {saving ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </>
              )}
            </div>
          </div>

          {!draft.id && (
            <div className="card flex flex-col gap-4 p-5">
              <div>
                <div className="label">Elige los agentes del equipo</div>
                <p className="mt-1 text-xs text-muted">Marca los agentes que quieres en este equipo. Aparecerán en la oficina cuando lo actives.</p>
              </div>
              {agentPicker}
            </div>
          )}
          {pickingAgents && draft.id && (
            <Modal title="Elegir agentes del equipo" wide onClose={() => setPickingAgents(false)}>
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div>
                  <div className="label">Elige los agentes del equipo</div>
                  <p className="mt-1 text-xs text-muted">Marca los agentes que quieres en «{draft.name || 'este equipo'}». Los cambios se guardan con «Guardar cambios».</p>
                </div>
                <button type="button" onClick={() => setPickingAgents(false)} className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-bg">Listo</button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">{agentPicker}</div>
            </Modal>
          )}

          {draft.members.length > 0 && (
            <div className="card flex flex-col gap-4 p-5">
              <div>
                <div className="label">Contexto de cada agente</div>
                <p className="mt-1 text-xs text-muted">Puedes ponerle un nombre a cada agente: así se ve en la oficina y así se presenta. Lo que escribas en el contexto se adjunta a la conversación de ese agente cuando trabaja en este equipo: su negocio, tono, reglas y datos que debe conocer.</p>
              </div>
              {draft.members.map((m) => {
                const a = findAgent(m.agent_id)
                return (
                  <div key={m.agent_id} className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPicking(m.agent_id)}
                        aria-label={`Cambiar avatar de ${a?.name ?? m.agent_id}`}
                        title="Cambiar avatar"
                        className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-line bg-bg hover:border-blue"
                      >
                        <img src={`/faces/face-${faceOf(m)}.png`} alt="" className="h-full w-full object-cover" style={{ imageRendering: 'pixelated' }} />
                      </button>
                      <span className="text-sm font-semibold">
                        {a?.name ?? m.agent_id}
                      </span>
                      <label htmlFor={`name-${m.agent_id}`} className="text-xs font-semibold text-muted">Nombre</label>
                      <input
                        aria-label={`Nombre de ${a?.name ?? m.agent_id}`}
                        id={`name-${m.agent_id}`}
                        value={m.display_name}
                        onChange={(e) => setField(m.agent_id, { display_name: e.target.value })}
                        placeholder="Ponle un nombre (ej. Sofía)"
                        maxLength={40}
                        className="min-w-[200px] flex-1 rounded-sm border border-line px-3 py-1 text-sm outline-none focus:border-blue sm:max-w-[280px]"
                      />
                      <NameSuggest face={faceOf(m)} label={a?.name ?? m.agent_id} current={m.display_name} taken={[...draft.members.map((x) => x.display_name), cooDraft.display_name]} onPick={(n) => setField(m.agent_id, { display_name: n })} />
                    </div>
                    <SessionField id={`session-${m.agent_id}`} label={a?.name ?? m.agent_id} taken={[...draft.members.filter((x) => x.agent_id !== m.agent_id).map((x) => x.session_ref ?? ''), cooDraft.session_ref ?? ''].filter(Boolean)} emptyHint="vacía, la E abre una conversación nueva en Cowork con «Hola, ahora eres un …»; envíala y pega aquí su enlace." value={m.session_ref ?? ''} onChange={(v) => setField(m.agent_id, { session_ref: v || null })} />
                    <label htmlFor={`ctx-${m.agent_id}`} className="text-xs font-semibold text-muted">Contexto en este equipo</label>
                    <textarea
                      id={`ctx-${m.agent_id}`}
                      aria-label={`Contexto de ${a?.name ?? m.agent_id}`}
                      value={m.context}
                      onChange={(e) => setField(m.agent_id, { context: e.target.value })}
                      rows={4}
                      maxLength={MAX_CONTEXT}
                      placeholder={`Ej. Tono cercano y profesional. Solo usa datos confirmados con fuente.`}
                      className="resize-y rounded-sm border border-line px-3 py-2 text-sm leading-relaxed outline-none focus:border-blue"
                    />
                    <div className="text-right font-mono text-[11px] text-muted">{m.context.length} / {MAX_CONTEXT}</div>
                    <details className="group rounded-sm border border-line">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted hover:text-ink">Descripción del agente <span className="font-normal">(.claude/agents/{m.agent_id}.md de este proyecto)</span></summary>
                      <div className="border-t border-line p-3"><AgentDefEditor agentId={m.agent_id} scope="project" /></div>
                    </details>
                    <AgentCanvasSection agentId={m.agent_id} name={m.display_name || a?.name || m.agent_id} />
                  </div>
                )
              })}
            </div>
          )}

          {error && <div className="card border-red p-3 text-sm text-red" role="alert">{error}</div>}

          <div className="flex flex-wrap items-center gap-3">
            {draft.id && (
              <button disabled={saving} onClick={remove} className="ml-auto text-sm font-semibold text-red hover:underline disabled:opacity-40">Borrar equipo</button>
            )}
          </div>
        </section>
        )}
      </div>

      <section className="card mt-6 flex flex-col gap-3 p-5" aria-label="Plantillas globales de agentes">
        <div>
          <h2 className="label">Plantillas globales de agentes</h2>
          <p className="mt-1 text-xs text-muted">Archivos en ~/.claude/agents: valen en cualquier carpeta y son la base de la copia de cada proyecto. Si un proyecto no tiene copia propia, usa esta plantilla; si no hay plantilla, el original del plugin.</p>
        </div>
        <GlobalAgentDefs />
      </section>

      {picking && (
        <div className="fixed inset-0 flex items-center justify-center bg-ink/40 p-4" style={{ zIndex: 50 }} onClick={() => setPicking(null)}>
          <div role="dialog" aria-label="Elegir avatar" className="card flex h-[min(720px,90vh)] w-[min(980px,100%)] flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <div className="label">Avatar de {picking === 'coo' ? (cooDraft.display_name || COO_AGENT.name) : (findAgent(picking)?.name ?? picking)}</div>
                <p className="text-xs text-muted">Elige una cara. Las marcadas «en uso» ya las tiene otro agente de este equipo.</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg" onClick={() => { if (picking === 'coo') setCooDraft((d) => ({ ...d, avatar: null })); else setField(picking, { avatar: null }); setPicking(null) }}>Restablecer</button>
                <button className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg" onClick={() => setPicking(null)}>Cerrar</button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <AvatarGallery
                value={picking === 'coo' ? cooFace : faceOf(draft.members.find((m) => m.agent_id === picking)!)}
                taken={picking === 'coo' ? draft.members.map(faceOf) : [cooFace, ...draft.members.filter((m) => m.agent_id !== picking).map(faceOf)]}
                onPick={(f) => { if (picking === 'coo') setCooDraft((d) => ({ ...d, avatar: f })); else setField(picking, { avatar: f }); setPicking(null) }}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
