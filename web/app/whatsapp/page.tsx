'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import { Conversation, DraftEditor } from '@/components/WhatsAppPanel'
import { useWaStatus } from '@/components/WhatsAppPill'
import type { WaChat, WaDraft } from '@/lib/types'
import { getJson, put, useBackOffice } from '@/lib/useBackOffice'

export default function WhatsAppPage() {
  const { conn, workspaces, waTick } = useBackOffice()
  const status = useWaStatus()
  const [chats, setChats] = useState<WaChat[]>([])
  const [drafts, setDrafts] = useState<WaDraft[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ws, setWs] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([getJson('/api/whatsapp/chats'), getJson('/api/whatsapp/drafts?status=draft')])
      setChats(c); setDrafts(d)
    } catch { /* the pill already says it is down */ }
  }, [])
  useEffect(() => { void load() }, [load, waTick])
  const target = ws ?? status?.workspace ?? 'default'
  const changeWs = async (id: string) => {
    setWs(id); setMsg(null)
    try { await put('/api/human/whatsapp/settings', { workspace: id }); setMsg('Listo: los mensajes nuevos llegarán a ese proyecto.') } catch (e) { setMsg(e instanceof Error ? e.message : 'No se pudo guardar') }
  }
  const state = !status ? '…' : !status.configured ? 'No configurado' : status.connected ? 'Conectado' : 'Desconectado'
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight">WhatsApp</h1>
        <Link href="/leads" className="text-sm font-semibold text-blue hover:underline">← Leads</Link>
      </div>

      <section className="grid gap-3 rounded-sm border border-line bg-surface p-4 sm:grid-cols-3" aria-label="Estado">
        <div><div className="label !text-[10px]">Estado</div><div className="text-sm font-semibold">{state}</div></div>
        <label><span className="label mb-1 block !text-[10px]">Proyecto que recibe los mensajes</span>
          <select className="w-full rounded-sm border border-line bg-bg px-3 py-2 text-sm" value={target} onChange={(e) => void changeWs(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <div><div className="label !text-[10px]">Límites</div>
          <div className="text-sm">{status ? `${status.limits.max_per_hour}/hora · ${status.limits.max_per_day}/día · ${status.limits.max_text_length} caracteres` : '…'}</div>
          {status && <div className="text-xs text-muted">Enviados en la última hora: {status.sent_last_hour}</div>}
        </div>
        {msg && <p role="status" className="text-xs text-muted sm:col-span-3">{msg}</p>}
      </section>

      <section className="rounded-sm border border-line bg-surface p-4" aria-label="Cómo conectar">
        <h2 className="mb-2 text-sm font-bold">Cómo conectar</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>En tu terminal corre <code className="rounded-sm bg-bg px-1">backoffice whatsapp</code>.</li>
          <li>Escanea el QR con WhatsApp → Dispositivos vinculados.</li>
          <li>Cuando esta página diga «Conectado», los mensajes que te escriban aparecen como leads.</li>
        </ol>
        <p className="mt-3 rounded-sm bg-red-soft px-3 py-2 text-xs text-red">
          Aviso: esta conexión no es oficial de WhatsApp y existe el riesgo de que bloqueen el número. Usa un número de prueba, mantén volúmenes humanos y recuerda que nada se envía sin tu clic.
        </p>
      </section>

      <section aria-label="Borradores pendientes" className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">Borradores pendientes ({drafts.length})</h2>
        {drafts.length === 0 && <p className="text-xs text-muted">Cuando un agente redacte una respuesta, la revisas y la envías aquí.</p>}
        {drafts.map((d) => (
          <div key={d.id}><div className="mb-1 text-xs text-muted">Para +{d.phone}</div><DraftEditor draft={d} onChange={() => void load()} /></div>
        ))}
      </section>

      <section aria-label="Chats recientes" className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">Chats recientes</h2>
        {chats.length === 0 && <p className="text-xs text-muted">Todavía no ha llegado ningún mensaje.</p>}
        {chats.map((c) => (
          <div key={c.chat_id} className="rounded-sm border border-line bg-surface">
            <button type="button" onClick={() => setOpen(open === c.chat_id ? null : c.chat_id)} aria-expanded={open === c.chat_id} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{c.name ?? `+${c.phone}`}</span>
                <span className="block truncate text-xs text-muted">{c.last_message.direction === 'out' ? 'Tú: ' : ''}{c.last_message.body}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {c.unanswered > 0 && <span className="rounded-full bg-blue px-2 py-0.5 font-semibold text-white">{c.unanswered} sin responder</span>}
                {c.pending_drafts > 0 && <span className="rounded-full border border-line px-2 py-0.5 text-muted">{c.pending_drafts} borrador(es)</span>}
              </span>
            </button>
            {open === c.chat_id && <div className="border-t border-line p-4"><Conversation chatId={c.chat_id} /></div>}
          </div>
        ))}
      </section>
    </main>
  )
}
