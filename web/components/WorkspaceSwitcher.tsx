'use client'
import { useBackOffice } from '@/lib/useBackOffice'

// One Back Office = one company: the company name is a label, not a selector (another company = another Back Office).
export default function WorkspaceSwitcher() {
  const { workspaces, workspace, workspaceId, conn } = useBackOffice()
  const cur = workspace ?? workspaces.find((w) => w.id === workspaceId) ?? null
  return (
    <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold" aria-label={`Empresa: ${cur?.name ?? workspaceId}`}>
      <span className="relative inline-block h-3 w-3"><i className="absolute left-0 top-0 h-[7px] w-[7px] rounded-sm bg-blue" /><i className="absolute bottom-0 right-0 h-[7px] w-[7px] rounded-sm bg-orange" /></span>
      <span className="max-w-[160px] truncate">{cur?.name ?? (conn === 'live' ? workspaceId : 'Mi empresa')}</span>
    </span>
  )
}
