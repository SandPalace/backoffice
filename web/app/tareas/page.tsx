'use client'
import Header from '@/components/Header'
import KanbanBoard from '@/components/KanbanBoard'
import { useBackOffice } from '@/lib/useBackOffice'

export default function TareasPage() {
  const { tasks, conn, workspace, workspaceId } = useBackOffice()
  const open = tasks.filter((t) => t.status !== 'done').length
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">Tareas · {workspace?.name ?? workspaceId}</h1>
        <span className="text-sm text-muted">{open} abiertas · {tasks.length} en total</span>
      </div>
      <KanbanBoard tasks={tasks} />
    </main>
  )
}
