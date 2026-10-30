'use client'
import { useMemo, useState } from 'react'
import type { Epic, EpicStatus, Sprint, SprintStatus, Story, StoryStatus, Task } from '@/lib/types'
import { post } from '@/lib/useBackOffice'
import { progress, sortSprints } from '@/lib/agile'

const EPIC: Record<EpicStatus, { label: string; cls: string }> = {
  planning: { label: 'Planeando', cls: 'bg-bg text-muted' },
  active: { label: 'Activa', cls: 'bg-blue-soft text-blue' },
  done: { label: 'Terminada', cls: 'bg-teal-soft text-teal' },
  cancelled: { label: 'Cancelada', cls: 'bg-bg text-muted line-through' },
}
const STORY: Record<StoryStatus, { label: string; cls: string }> = {
  backlog: { label: 'Backlog', cls: 'bg-bg text-muted' },
  todo: { label: 'Por hacer', cls: 'bg-bg text-ink' },
  doing: { label: 'En curso', cls: 'bg-blue-soft text-blue' },
  review: { label: 'Revisión', cls: 'bg-amber-soft text-amber' },
  done: { label: 'Aprobada', cls: 'bg-teal-soft text-teal' },
  cancelled: { label: 'Cancelada', cls: 'bg-bg text-muted line-through' },
}
const SPRINT: Record<SprintStatus, { label: string; cls: string }> = {
  planning: { label: 'Planeando', cls: 'bg-bg text-muted' },
  active: { label: 'Activo', cls: 'bg-blue-soft text-blue' },
  review: { label: 'En revisión', cls: 'bg-amber-soft text-amber' },
  completed: { label: 'Completado', cls: 'bg-teal-soft text-teal' },
}
const pill = 'flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide'
const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '¿?')

function Bar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-teal" style={{ width: `${percent}%` }} />
    </div>
  )
}

function StoryRow({ s, tasks }: { s: Story; tasks: Task[] }) {
  const p = progress(tasks)
  return (
    <li className="flex items-center gap-2 rounded-sm bg-bg/60 px-2.5 py-1.5 text-xs">
      <span className={`${pill} ${STORY[s.status].cls}`}>{STORY[s.status].label}</span>
      <span className="min-w-0 flex-1 truncate font-semibold" title={s.description ?? s.title}>{s.title}</span>
      {s.points != null && <span className="flex-none text-muted" title="Puntos">{s.points} pts</span>}
      <span className="flex-none text-muted" title="Tareas aprobadas / tareas">{p.done}/{p.total} tareas</span>
    </li>
  )
}

function SprintCard({ sp, tasks, others }: { sp: Sprint; tasks: Task[]; others: Sprint[] }) {
  const p = progress(tasks)
  const [closing, setClosing] = useState(false)
  const [to, setTo] = useState('backlog')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length
  const complete = async () => {
    setBusy(true)
    setErr(null)
    try {
      await post(`/api/human/sprints/${sp.id}/complete`, to === 'backlog' ? {} : { rollover_to: to })
      setClosing(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo completar')
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className={`rounded-sm border bg-surface p-3 ${sp.status === 'active' ? 'border-blue' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{sp.name}</div>
          <div className="text-xs text-muted">{fmt(sp.start_date)} → {fmt(sp.end_date)}</div>
        </div>
        <span className={`${pill} ${SPRINT[sp.status].cls}`}>{SPRINT[sp.status].label}</span>
      </div>
      {sp.goal && <p className="mt-2 text-xs">{sp.goal}</p>}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <Bar percent={p.percent} />
        <span className="flex-none">{p.done}/{p.total} · {p.percent}%</span>
      </div>
      {sp.report && (sp.status === 'review' || sp.status === 'completed') && (
        <details className="mt-2 text-xs" open={sp.status === 'review'}>
          <summary className="cursor-pointer font-semibold text-muted">Reporte del sprint</summary>
          <p className="mt-1 whitespace-pre-wrap">{sp.report}</p>
        </details>
      )}
      {(sp.status === 'active' || sp.status === 'review') && !closing && (
        <button className="mt-3 w-full rounded-full bg-blue px-4 py-2 text-xs font-semibold text-white hover:opacity-90" onClick={() => setClosing(true)}>Completar sprint</button>
      )}
      {closing && (
        <div className="mt-3 rounded-sm border border-line p-2 text-xs">
          <label className="block">
            <span className="text-muted">{open ? `${open} tareas sin terminar pasan a:` : 'No quedan tareas pendientes.'}</span>
            {open > 0 && (
              <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-xs">
                <option value="backlog">Backlog (sin sprint)</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </label>
          {err && <p role="alert" className="mt-2 text-red">{err}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <button className="rounded-full border border-line px-3 py-1 font-semibold text-muted hover:text-ink" onClick={() => setClosing(false)}>Cancelar</button>
            <button className="rounded-full bg-blue px-3 py-1 font-semibold text-white hover:opacity-90 disabled:opacity-50" disabled={busy} onClick={complete}>Confirmar</button>
          </div>
        </div>
      )}
    </li>
  )
}

export default function PlanView({ epics, stories, sprints, tasks }: { epics: Epic[]; stories: Story[]; sprints: Sprint[]; tasks: Task[] }) {
  const tasksOf = useMemo(() => {
    const by = new Map<string, Task[]>()
    for (const t of tasks) for (const k of [t.story_id && `s:${t.story_id}`, t.sprint_id && `p:${t.sprint_id}`]) if (k) by.set(k, [...(by.get(k) ?? []), t])
    return (k: string) => by.get(k) ?? []
  }, [tasks])
  const sorted = useMemo(() => sortSprints(sprints), [sprints])
  const groups = [...[...epics].sort((a, b) => a.created_at - b.created_at).map((e) => ({ epic: e as Epic | null, list: stories.filter((s) => s.epic_id === e.id) })),
    { epic: null, list: stories.filter((s) => !s.epic_id || !epics.some((e) => e.id === s.epic_id)) }].filter((g) => g.epic || g.list.length)
  const sortStories = (l: Story[]) => [...l].sort((a, b) => a.created_at - b.created_at)
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="card p-4" aria-label="Épicas e historias">
        <div className="label mb-3">Épicas e historias</div>
        {groups.length === 0 && <p className="text-sm text-muted">Todavía no hay plan. Pídele al CEO que convierta el plan en una épica con historias y el primer sprint.</p>}
        <div className="flex flex-col gap-4">
          {groups.map(({ epic, list }) => {
            const pts = list.filter((s) => s.status !== 'cancelled').reduce((n, s) => n + (s.points ?? 0), 0)
            const ptsDone = list.filter((s) => s.status === 'done').reduce((n, s) => n + (s.points ?? 0), 0)
            return (
              <div key={epic?.id ?? 'none'}>
                <div className="mb-2 flex items-center gap-2">
                  {epic && <span className={`${pill} ${EPIC[epic.status].cls}`}>{EPIC[epic.status].label}</span>}
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold" title={epic?.description ?? undefined}>{epic ? epic.title : 'Sin épica'}</h3>
                  <span className="flex-none text-xs text-muted">{list.length} historias{pts ? ` · ${ptsDone}/${pts} pts` : ''}</span>
                </div>
                {list.length === 0 ? <p className="text-xs text-muted">Sin historias todavía.</p> : (
                  <ul className="flex flex-col gap-1">{sortStories(list).map((s) => <StoryRow key={s.id} s={s} tasks={tasksOf(`s:${s.id}`)} />)}</ul>
                )}
              </div>
            )
          })}
        </div>
      </section>
      <section className="card p-4" aria-label="Sprints">
        <div className="label mb-3">Sprints</div>
        {sorted.length === 0 && <p className="text-sm text-muted">Sin sprints.</p>}
        <ul className="flex flex-col gap-2">
          {sorted.map((sp) => <SprintCard key={sp.id} sp={sp} tasks={tasksOf(`p:${sp.id}`)} others={sorted.filter((o) => o.id !== sp.id && o.status !== 'completed')} />)}
        </ul>
        <p className="mt-3 text-[11px] text-muted">Los agentes planean y mueven el trabajo; sólo tú apruebas, cancelas y completas un sprint.</p>
      </section>
    </div>
  )
}
