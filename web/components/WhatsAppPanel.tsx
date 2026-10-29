'use client'
import { useCallback, useEffect, useState } from 'react'
import type { WaChat, WaDraft, WaMessage } from '@/lib/types'
import { getJson, post, send, useBackOffice } from '@/lib/useBackOffice'

const hhmm = (ts: number) => new Date(ts).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const field = 'w-full rounded-sm border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-blue'
const errMsg = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb)

/** One pending draft: editable text, «Enviar» (asks first) and «Descartar». Nothing leaves without the person's click. */
export function DraftEditor({ draft, onChange }: { draft: WaDraft; onChange?: () => void }) {
  const [text, setText] = useState(draft.text)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => setText(draft.text), [draft.text])
  const run = async (fn: () => Promise<unknown>, fb: string) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg(errMsg(e, fb)) }
    setBusy(false)
    onChange?.()
  }
  const doSend = () => {
    if (!text.trim()) return setMsg('El mensaje está vacío')
    if (!window.confirm(`¿Enviar este mensaje por WhatsApp?\n\n${text}`)) return
    void run(async () => {
      const d: WaDraft = await post(`/api/human/whatsapp/drafts/${draft.id}/send`, { text })
      if (d.status === 'failed') setMsg(d.error ?? 'No se pudo enviar')
    }, 'No se pudo enviar')
  }
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-3">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Borrador{draft.created_by ? ` de ${draft.created_by}` : ''}{draft.status === 'failed' ? ' · falló' : ''}</span>
        <span>{text.length}/1500</span>
      </div>
      <textarea className={`${field} min-h-[80px]`} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto del borrador" />
      {(msg || draft.error) && <p role="alert" className="rounded-sm bg-red-soft px-3 py-1.5 text-xs text-red">{msg ?? draft.error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => void run(() => send('DELETE', `/api/human/whatsapp/drafts/${draft.id}`), 'No se pudo descartar')} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink disabled:opacity-50">Descartar</button>
        {text !== draft.text && <button type="button" disabled={busy} onClick={() => void run(() => send('PATCH', `/api/human/whatsapp/drafts/${draft.id}`, { text }), 'No se pudo guardar')} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-50">Guardar texto</button>}
        <button type="button" disabled={busy} onClick={doSend} className="rounded-full bg-blue px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Enviar</button>
      </div>
    </div>
  )
}

/** Conversation bubbles for a chat plus its pending drafts. */
export function Conversation({ chatId }: { chatId: string }) {
  const { waTick } = useBackOffice()
  const [msgs, setMsgs] = useState<WaMessage[]>([])
  const [drafts, setDrafts] = useState<WaDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([getJson(`/api/whatsapp/messages?chat_id=${encodeURIComponent(chatId)}`), getJson(`/api/whatsapp/drafts?chat_id=${encodeURIComponent(chatId)}`)])
      setMsgs(m); setDrafts((d as WaDraft[]).filter((x) => x.status === 'draft' || x.status === 'failed')); setError(null)
    } catch (e) { setError(errMsg(e, 'No se pudo cargar la conversación')) }
  }, [chatId])
  useEffect(() => { void load() }, [load, waTick])
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{error}</p>}
      <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto rounded-sm border border-line bg-bg p-3">
        {msgs.length === 0 && <p className="text-xs text-muted">Sin mensajes todavía.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm ${m.direction === 'out' ? 'self-end bg-blue text-white' : 'self-start border border-line bg-surface'}`}>
            {m.body}
            <div className={`mt-0.5 text-[10px] ${m.direction === 'out' ? 'text-white/70' : 'text-muted'}`}>{hhmm(m.ts)}</div>
          </div>
        ))}
      </div>
      {drafts.map((d) => <DraftEditor key={d.id} draft={d} onChange={() => void load()} />)}
    </div>
  )
}

/** «WhatsApp» section of the lead modal: only when the lead has a chat. */
export default function WhatsAppPanel({ leadId }: { leadId: string }) {
  const { waTick } = useBackOffice()
  const [chat, setChat] = useState<WaChat | null | undefined>(undefined)
  useEffect(() => {
    let off = false
    getJson('/api/whatsapp/chats').then((l: WaChat[]) => { if (!off) setChat(l.find((c) => c.lead_id === leadId) ?? null) }).catch(() => { if (!off) setChat(null) })
    return () => { off = true }
  }, [leadId, waTick])
  if (!chat) return null
  return (
    <section className="flex flex-col gap-2 sm:col-span-2" aria-label="WhatsApp">
      <div className="flex items-baseline justify-between">
        <h3 className="label !text-[10px]">WhatsApp · +{chat.phone}</h3>
        {chat.unanswered > 0 && <span className="text-[11px] font-semibold text-blue">{chat.unanswered} sin responder</span>}
      </div>
      <Conversation chatId={chat.chat_id} />
    </section>
  )
}
