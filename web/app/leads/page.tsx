'use client'
import Header from '@/components/Header'
import LeadsBoard from '@/components/LeadsBoard'
import WhatsAppPill from '@/components/WhatsAppPill'
import { useBackOffice } from '@/lib/useBackOffice'

export default function LeadsPage() {
  const { leads, conn, workspace, workspaceId } = useBackOffice()
  const open = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">Leads · {workspace?.name ?? workspaceId}</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <WhatsAppPill />
          <span className="text-sm text-muted">{open} en seguimiento · {leads.length} en total</span>
        </div>
      </div>
      <LeadsBoard leads={leads} />
    </main>
  )
}
