'use client'
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import KanbanBoard from '@/components/KanbanBoard'
import PlanView from '@/components/PlanView'
import { useBackOffice } from '@/lib/useBackOffice'
import { ALL, NONE, defaultSprintFilter, filterTasks, sortSprints } from '@/lib/agile'

const select = 'rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink focus:border-blue focus:outline-none'

export default function TareasPage() {
  const { tasks, epics, stories, sprints, conn, ready, workspace, workspaceId } = useBackOffice()
  const [view, setView] = useState<'board' | 'plan'>('board')
  const [sprint, setSprint] = useState<string | null>(null) // null = not chosen yet → default once data arrives
  const [epic, setEpic] = useState(ALL)
  useEffect(() => { if (ready && sprint === null) setSprint(defaultSprintFilter(sprints)) }, [ready, sprints, sprint])
  // A sprint that disappears (deleted) falls back to the default.
  useEffect(() => { if (sprint && sprint !== ALL && sprint !== NONE && !sprints.some((s) => s.id === sprint)) setSprint(defaultSprintFilter(sprints)) }, [sprints, sprint])
  const sprintOpts = useMemo(() => sortSprints(sprints), [sprints])
  const shown = useMemo(() => filterTasks(tasks, stories, sprint ?? ALL, epic), [tasks, stories, sprint, epic])
  const open = shown.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length
  const tab = (v: 'board' | 'plan', label: string) => (
    <button type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 ${view === v ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>{label}</button>
  )
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight">Tareas · {workspace?.name ?? workspaceId}</h1>
          <div role="group" aria-label="Vista" className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 text-xs font-semibold">
            {tab('board', 'Tablero')}
            {tab('plan', 'Plan')}
          </div>
        </div>
        {view === 'board' && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Sprint" value={sprint ?? ALL} onChange={(e) => setSprint(e.target.value)} className={select}>
              <option value={ALL}>Todos los sprints</option>
              <option value={NONE}>Sin sprint</option>
              {sprintOpts.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status === 'active' ? ' (activo)' : s.status === 'completed' ? ' (completado)' : ''}</option>)}
            </select>
            <select aria-label="Épica" value={epic} onChange={(e) => setEpic(e.target.value)} className={select}>
              <option value={ALL}>Todas las épicas</option>
              {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            <span className="text-sm text-muted">{open} abiertas · {shown.length} de {tasks.length}</span>
          </div>
        )}
      </div>
      {view === 'board' ? <KanbanBoard tasks={shown} /> : <PlanView epics={epics} stories={stories} sprints={sprints} tasks={tasks} />}
    </main>
  )
}
