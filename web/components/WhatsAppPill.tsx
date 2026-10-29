'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { WaStatus } from '@/lib/types'
import { getJson, useBackOffice } from '@/lib/useBackOffice'

export function useWaStatus() {
  const { waTick, workspaceId } = useBackOffice()
  const [status, setStatus] = useState<WaStatus | null>(null)
  useEffect(() => {
    let off = false
    const load = () => getJson('/api/whatsapp/status').then((s) => { if (!off) setStatus(s) }).catch(() => { if (!off) setStatus(null) })
    void load()
    const t = setInterval(load, 15000)
    return () => { off = true; clearInterval(t) }
  }, [waTick, workspaceId])
  return status
}

/** Small status pill for the Leads header. */
export default function WhatsAppPill() {
  const s = useWaStatus()
  if (!s) return null
  const [label, dot] = !s.configured ? ['WhatsApp no configurado', 'bg-muted'] : s.connected ? ['WhatsApp conectado', 'bg-teal'] : ['WhatsApp desconectado', 'bg-red']
  return (
    <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted" role="status">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
      <Link href="/whatsapp" className="font-semibold text-blue hover:underline">Cómo conectar</Link>
    </span>
  )
}
