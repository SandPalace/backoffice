'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Lead, LeadSource, LeadStage } from '@/lib/types'
import { post, send } from '@/lib/useBackOffice'
import Modal from './Modal'
import WhatsAppPanel from './WhatsAppPanel'

const COLUMNS: { stage: LeadStage; title: string; hint: string; dot: string }[] = [
  { stage: 'new', title: 'Nuevo', hint: 'Prospectos que acaban de llegar', dot: 'bg-muted' },
  { stage: 'contacted', title: 'En conversación', hint: 'Ya hubo un primer contacto', dot: 'bg-blue' },
  { stage: 'qualified', title: 'Calificado', hint: 'Encaja y tiene interés real', dot: 'bg-purple' },
  { stage: 'proposal', title: 'Propuesta', hint: 'Cotización enviada', dot: 'bg-amber' },
  { stage: 'won', title: 'Ganado', hint: 'Cerraste la venta', dot: 'bg-teal' },
  { stage: 'lost', title: 'Perdido', hint: 'No se concretó', dot: 'bg-red' },
]
const SOURCES: { id: LeadSource; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' }, { id: 'instagram', label: 'Instagram' }, { id: 'facebook', label: 'Facebook' }, { id: 'meta_form', label: 'Formulario Meta' },
  { id: 'email', label: 'Correo' }, { id: 'web', label: 'Sitio web' }, { id: 'referral', label: 'Referido' }, { id: 'other', label: 'Otro' },
]
const sourceLabel = (s: LeadSource) => SOURCES.find((x) => x.id === s)?.label ?? s
const stageTitle = (s: LeadStage) => COLUMNS.find((c) => c.stage === s)?.title ?? s
const money = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// Fecha corta para tarjetas: «20 oct» (el año solo si no es el actual).
const shortDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) }
const fmtDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) }
const isOpen = (l: Lead) => l.stage !== 'won' && l.stage !== 'lost'

function scoreInfo(n: number) {
  if (n >= 70) return { label: 'Caliente', cls: 'bg-orange-soft text-orange' }
  if (n >= 40) return { label: 'Tibio', cls: 'bg-amber-soft text-amber' }
  return { label: 'Frío', cls: 'bg-blue-soft text-blue' }
}

const field = 'w-full rounded-sm border border-line bg-bg px-2 py-1.5 text-xs text-ink placeholder:text-muted focus:border-blue focus:outline-none'

function LeadMenu({ l, busy, onMove, onDelete, onOpenChange }: { l: Lead; busy: boolean; onMove: (s: LeadStage) => void; onDelete: () => void; onOpenChange?: (open: boolean) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => { onOpenChange?.(pos !== null) }, [pos]) // eslint-disable-line react-hooks/exhaustive-deps
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const close = (refocus = true) => { setPos(null); if (refocus) btn.current?.focus() }
  const openMenu = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)), y: Math.min(r.bottom + 4, window.innerHeight - 290) })
  }
  useEffect(() => {
    if (!pos) return
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null) }
    const dismiss = () => setPos(null)
    document.addEventListener('mousedown', away)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss) }
  }, [pos])
  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus() }
    else if (e.key === 'Tab') { e.preventDefault(); close() }
  }
  const item = 'block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-bg focus:bg-bg focus:outline-none'
  return (
    <>
      <button ref={btn} type="button" aria-label="Acciones del lead" title="Acciones del lead" aria-haspopup="menu" aria-expanded={pos !== null} disabled={busy}
        onClick={(e) => { e.stopPropagation(); pos ? close(false) : openMenu() }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !pos) { e.preventDefault(); openMenu() } }}
        className="-mr-1 -mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-sm text-base font-bold leading-none text-muted hover:bg-bg hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue disabled:opacity-50">
        <span aria-hidden="true">⋯</span>
      </button>
      {pos && (
        <div ref={menu} role="menu" aria-label={`Acciones de ${l.name}`} onKeyDown={onKey} style={{ left: pos.x, top: pos.y }} className="fixed z-50 w-[190px] rounded-sm border border-line bg-surface py-1 shadow-lg">
          <div className="label px-3 pb-1 pt-1 !text-[10px]" aria-hidden="true">Mover a etapa</div>
          {COLUMNS.filter((c) => c.stage !== l.stage).map((c) => (
            <button key={c.stage} role="menuitem" tabIndex={-1} className={item} onClick={() => { close(false); onMove(c.stage) }}>
              <span className={`mr-2 inline-block h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />{c.title}
            </button>
          ))}
          <div role="separator" className="my-1 border-t border-line" />
          <button role="menuitem" tabIndex={-1} className={`${item} text-red`} onClick={() => { close(false); onDelete() }}>Borrar lead</button>
        </div>
      )}
    </>
  )
}

function NewLeadForm({ stage, title, onDone, onError }: { stage: LeadStage; title: string; onDone: () => void; onError: (m: string | null) => void }) {
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [source, setSource] = useState<LeadSource>('whatsapp')
  const [interest, setInterest] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!name.trim() || saving) return
    if (stage === 'lost') { onError('Para marcar un lead como perdido, créalo en otra etapa y muévelo indicando el motivo.'); return }
    setSaving(true)
    onError(null)
    try {
      await post('/api/human/leads', { name: name.trim(), stage, source, ...(contact.trim() ? { contact: contact.trim() } : {}), ...(interest.trim() ? { interest: interest.trim() } : {}) })
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear el lead')
      setSaving(false)
    }
  }
  return (
    <form className="mb-2 flex flex-col gap-2 rounded-sm border border-line bg-surface p-2" aria-label={`Nuevo lead en ${title}`}
      onSubmit={(e) => { e.preventDefault(); void submit() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone() } }}>
      <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre" className={field} />
      <input value={contact} maxLength={200} onChange={(e) => setContact(e.target.value)} placeholder="Contacto (teléfono, correo, @usuario)" aria-label="Contacto" className={field} />
      <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)} aria-label="Origen" className={field}>
        {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <input value={interest} maxLength={300} onChange={(e) => setInterest(e.target.value)} placeholder="Interés" aria-label="Interés" className={field} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-ink">Cancelar</button>
        <button type="submit" disabled={!name.trim() || saving} className="rounded-full bg-blue px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Crear</button>
      </div>
    </form>
  )
}

function Card({ l, busy, dragLocked, dragging, onOpen, onMove, onDelete, onDragStart, onDragEnd }: { l: Lead; busy: boolean; dragLocked: boolean; dragging: boolean; onOpen: (l: Lead) => void; onMove: (l: Lead, s: LeadStage) => void; onDelete: (l: Lead) => void; onDragStart: (l: Lead) => void; onDragEnd: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const fromControl = useRef(false)
  const canDrag = !menuOpen && !busy && !dragLocked
  const overdue = isOpen(l) && !!l.next_contact_at && l.next_contact_at < todayStr()
  const sc = l.score != null ? scoreInfo(l.score) : null
  return (
    <li
      data-lead-id={l.id}
      draggable={canDrag}
      aria-roledescription="tarjeta arrastrable"
      title="Haz clic para ver el detalle, arrástrala o usa ⋯"
      onMouseDown={(e) => { fromControl.current = !!(e.target as HTMLElement).closest('button,a,input,select,textarea') }}
      onDragStart={(e) => {
        if (!canDrag || fromControl.current || e.target !== e.currentTarget) { e.preventDefault(); return }
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', l.id)
        onDragStart(l)
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a')) onOpen(l) }}
      className={`cursor-pointer rounded-sm border border-line bg-surface p-3 hover:border-blue ${dragging || busy ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={() => onOpen(l)} className="line-clamp-2 block max-w-full break-words text-left text-sm font-semibold leading-snug hover:text-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">{l.name}</button>
          {l.company && <div className="truncate text-xs text-muted">{l.company}</div>}
        </div>
        <LeadMenu l={l} busy={busy} onOpenChange={setMenuOpen} onMove={(s) => onMove(l, s)} onDelete={() => onDelete(l)} />
      </div>
      {l.interest && <p className="mt-1.5 line-clamp-2 text-xs text-ink">{l.interest}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-muted">{sourceLabel(l.source)}</span>
        {sc && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sc.cls}`}>{sc.label} · {l.score}</span>}
      </div>
      {(l.next_contact_at || l.value != null) && (
        <div className="mt-2 flex items-baseline justify-between gap-2 border-t border-line pt-2 text-xs">
          {l.next_contact_at
            ? <span className={`whitespace-nowrap ${overdue ? 'font-semibold text-red' : 'text-muted'}`} title={`Próximo contacto: ${fmtDate(l.next_contact_at)}${overdue ? ' (vencido)' : ''}`}>{overdue ? '⚠ ' : '→ '}{shortDate(l.next_contact_at)}</span>
            : <span />}
          {l.value != null && <span className="whitespace-nowrap font-semibold">{money(l.value)}</span>}
        </div>
      )}
    </li>
  )
}

function LeadDetail({ lead, onClose, onError }: { lead: Lead; onClose: () => void; onError: (m: string | null) => void }) {
  const [f, setF] = useState({
    name: lead.name, company: lead.company ?? '', contact: lead.contact ?? '', source: lead.source, interest: lead.interest ?? '', stage: lead.stage,
    score: lead.score == null ? '' : String(lead.score), next_contact_at: lead.next_contact_at ?? '', value: lead.value == null ? '' : String(lead.value),
    notes: lead.notes ?? '', lost_reason: lead.lost_reason ?? '', files: lead.files ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const save = async () => {
    const score = f.score.trim() === '' ? null : Number(f.score)
    const value = f.value.trim() === '' ? null : Number(f.value)
    if (!f.name.trim()) return setMsg('El nombre es obligatorio')
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) return setMsg('La calificación va de 0 a 100')
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setMsg('El valor debe ser un número positivo')
    if (f.stage === 'lost' && !f.lost_reason.trim() && !f.notes.trim()) return setMsg('Indica el motivo por el que se perdió')
    setSaving(true)
    setMsg(null)
    try {
      await send('PATCH', `/api/human/leads/${lead.id}`, {
        name: f.name.trim(), company: f.company, contact: f.contact, source: f.source, interest: f.interest, stage: f.stage, score, value,
        next_contact_at: f.next_contact_at || null, notes: f.notes, lost_reason: f.lost_reason, files: f.files,
      })
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo guardar')
      setSaving(false)
    }
  }
  const del = async () => {
    if (!window.confirm(`¿Borrar el lead «${lead.name}»? No se puede deshacer; los archivos en Archivos no se borran.`)) return
    try { await send('DELETE', `/api/human/leads/${lead.id}`); onClose() } catch (e) { onError(e instanceof Error ? e.message : 'No se pudo borrar') }
  }
  const lbl = 'label mb-1 block !text-[10px]'
  return (
    <Modal title={`Lead ${lead.name}`} onClose={onClose} wide>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="truncate text-base font-bold">{lead.name}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-lg leading-none text-muted hover:text-ink">×</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <label><span className={lbl}>Nombre</span><input className={field} maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label><span className={lbl}>Empresa</span><input className={field} maxLength={120} value={f.company} onChange={(e) => set('company', e.target.value)} /></label>
          <label><span className={lbl}>Contacto</span><input className={field} maxLength={200} value={f.contact} onChange={(e) => set('contact', e.target.value)} /></label>
          <label><span className={lbl}>Origen</span>
            <select className={field} value={f.source} onChange={(e) => set('source', e.target.value as LeadSource)}>{SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
          <label><span className={lbl}>Etapa</span>
            <select className={field} value={f.stage} onChange={(e) => set('stage', e.target.value as LeadStage)}>{COLUMNS.map((c) => <option key={c.stage} value={c.stage}>{c.title}</option>)}</select>
          </label>
          <label><span className={lbl}>Calificación (0–100)</span><input className={field} type="number" min={0} max={100} step={1} value={f.score} onChange={(e) => set('score', e.target.value)} /></label>
          <label><span className={lbl}>Próximo contacto</span><input className={field} type="date" value={f.next_contact_at} onChange={(e) => set('next_contact_at', e.target.value)} /></label>
          <label><span className={lbl}>Valor (MXN)</span><input className={field} type="number" min={0} step="any" value={f.value} onChange={(e) => set('value', e.target.value)} /></label>
          <label className="sm:col-span-2"><span className={lbl}>Interés</span><input className={field} maxLength={300} value={f.interest} onChange={(e) => set('interest', e.target.value)} /></label>
          {f.stage === 'lost' && (
            <label className="sm:col-span-2"><span className={lbl}>Motivo de pérdida</span><input className={field} maxLength={500} value={f.lost_reason} onChange={(e) => set('lost_reason', e.target.value)} /></label>
          )}
          <WhatsAppPanel leadId={lead.id} />
          <label className="sm:col-span-2"><span className={lbl}>Notas (markdown)</span><textarea className={`${field} min-h-[140px] font-mono`} maxLength={20000} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          <label className="sm:col-span-2"><span className={lbl}>Carpeta en Archivos</span><input className={field} maxLength={300} placeholder="ventas/prospectos/nombre/" value={f.files} onChange={(e) => set('files', e.target.value)} /></label>
          {lead.files && <Link href={`/archivos?prefix=${encodeURIComponent(lead.files)}`} className="text-xs font-semibold text-blue hover:underline sm:col-span-2">Ver archivos →</Link>}
          {lead.agent && <p className="text-xs text-muted sm:col-span-2">Última actualización por {lead.agent}</p>}
          {msg && <p role="alert" className="rounded-sm bg-red-soft px-3 py-2 text-xs text-red sm:col-span-2">{msg}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={() => void del()} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-red hover:bg-red-soft">Borrar lead</button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink">Cancelar</button>
            <button type="submit" disabled={saving} className="rounded-full bg-blue px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">Guardar</button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

export default function LeadsBoard({ leads }: { leads: Lead[] }) {
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState<LeadStage | null>(null)
  const [drag, setDrag] = useState<Lead | null>(null)
  const [over, setOver] = useState<LeadStage | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const opened = openId ? leads.find((l) => l.id === openId) ?? null : null
  const endDrag = () => { setDrag(null); setOver(null) }
  const byStage = (s: LeadStage) => leads.filter((l) => l.stage === s).sort((a, b) => a.position - b.position || b.created_at - a.created_at)

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setErr(null)
    setBusyId(id)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Algo falló') } finally { setBusyId(null) }
  }
  // Mover a una etapa; con `before` (id) o al final. Reordena calculando una posición entre vecinos.
  const moveTo = (l: Lead, stage: LeadStage, before?: string | null) => {
    const col = byStage(stage).filter((x) => x.id !== l.id)
    const idx = before ? col.findIndex((x) => x.id === before) : -1
    const i = idx < 0 ? col.length : idx
    const prev = col[i - 1]?.position
    const next = col[i]?.position
    const position = prev === undefined && next === undefined ? 0 : prev === undefined ? next! - 1 : next === undefined ? prev + 1 : (prev + next) / 2
    if (stage === l.stage && idx < 0 && col.length === byStage(stage).length - 1 && byStage(stage).at(-1)?.id === l.id) return
    const body: Record<string, unknown> = { stage, position }
    if (stage === 'lost' && l.stage !== 'lost') {
      const reason = window.prompt(`¿Por qué se perdió «${l.name}»?`)?.trim()
      if (!reason) return
      body.lost_reason = reason
    }
    void run(l.id, () => send('PATCH', `/api/human/leads/${l.id}`, body))
  }
  const remove = (l: Lead) => {
    if (!window.confirm(`¿Borrar el lead «${l.name}»? No se puede deshacer.`)) return
    void run(l.id, () => send('DELETE', `/api/human/leads/${l.id}`))
  }

  const today = todayStr()
  const open = leads.filter(isOpen)
  const proposalValue = leads.filter((l) => l.stage === 'proposal').reduce((n, l) => n + (l.value ?? 0), 0)
  const dueToday = open.filter((l) => l.next_contact_at && l.next_contact_at <= today).length
  const stat = 'card flex flex-col px-3 py-2'

  return (
    <section aria-label="Tablero Kanban de leads">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className={stat}><span className="label !text-[10px]">Total</span><span className="text-lg font-bold">{leads.length}</span></div>
        <div className={stat}>
          <span className="label !text-[10px]">Por etapa</span>
          <span className="flex flex-wrap gap-x-2 text-xs font-semibold">
            {COLUMNS.map((c) => <span key={c.stage} title={c.title} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />{byStage(c.stage).length}<span className="sr-only"> {c.title}</span></span>)}
          </span>
        </div>
        <div className={stat}><span className="label !text-[10px]">Valor en propuesta</span><span className="text-lg font-bold">{money(proposalValue)}</span></div>
        <div className={stat}><span className="label !text-[10px]">Para contactar hoy</span><span className={`text-lg font-bold ${dueToday ? 'text-orange' : ''}`}>{dueToday}</span></div>
      </div>
      {err && <div role="alert" className="mb-3 rounded-sm bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
      {leads.length === 0 && (
        <div role="status" className="card mb-4 p-5 text-sm text-muted">Todavía no hay leads. Aparecen cuando un agente de ventas los registra, o crea uno con el botón + de una columna.</div>
      )}
      <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-6 xl:overflow-visible">
        {COLUMNS.map((c) => {
          const list = byStage(c.stage)
          const hot = drag && over === c.stage
          return (
            <div
              key={c.stage}
              aria-label={c.title}
              onDragOver={(e) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== c.stage) setOver(c.stage) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === c.stage) setOver(null) }}
              onDrop={(e) => {
                if (!drag) return
                e.preventDefault()
                const l = drag
                const card = (e.target as HTMLElement).closest<HTMLElement>('[data-lead-id]')
                let before: string | null = card?.dataset.leadId ?? null
                if (card && before !== l.id) {
                  const r = card.getBoundingClientRect()
                  if (e.clientY > r.top + r.height / 2) before = list[list.findIndex((x) => x.id === before) + 1]?.id ?? null
                }
                endDrag()
                if (before !== l.id) moveTo(l, c.stage, before)
              }}
              className={`flex min-h-[220px] flex-col rounded-sm border p-2 ${hot ? 'border-blue bg-blue-soft/40' : 'border-line bg-bg/70'}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
                  <h2 className="text-xs font-bold uppercase tracking-wide">{c.title}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">{list.length}</span>
                  <button type="button" aria-label={`Nuevo lead en ${c.title}`} title={`Nuevo lead en ${c.title}`} aria-expanded={adding === c.stage}
                    onClick={() => setAdding(adding === c.stage ? null : c.stage)}
                    className="flex h-6 w-6 items-center justify-center rounded-sm text-base font-bold leading-none text-muted hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue">
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              </div>
              {adding === c.stage && <NewLeadForm stage={c.stage} title={c.title} onDone={() => setAdding(null)} onError={setErr} />}
              {list.length === 0 && adding !== c.stage ? (
                <p className="px-1 py-3 text-xs text-muted">{c.hint}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((l) => <Card key={l.id} l={l} busy={busyId === l.id} dragLocked={adding !== null} dragging={drag?.id === l.id} onOpen={(x) => setOpenId(x.id)} onMove={(x, s) => moveTo(x, s)} onDelete={remove} onDragStart={setDrag} onDragEnd={endDrag} />)}
                </ul>
              )}
            </div>
          )
        })}
      </div>
      {opened && <LeadDetail key={opened.id} lead={opened} onClose={() => setOpenId(null)} onError={setErr} />}
    </section>
  )
}
