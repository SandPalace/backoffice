'use client'
import { useEffect, useState } from 'react'
import { getJson, put, send } from '@/lib/useBackOffice'
import { findAgent } from '@/lib/roster'

// Archivo .md de Claude de un agente. scope=project → <raíz del proyecto>/.claude/agents/<id>.md (copia de este proyecto);
// scope=global → ~/.claude/agents/<id>.md (plantilla para todos los proyectos). Sin copia propia se muestra la plantilla.
type Def = { id: string; plugin: string; scope: 'project' | 'global'; file: string; exists: boolean; source: 'project' | 'global' | 'plugin'; content: string }
type Item = { id: string; plugin: string; exists: boolean }

const SOURCE: Record<Def['source'], string> = { project: 'Copia de este proyecto', global: 'Plantilla global', plugin: 'Original del plugin' }
const shortPath = (p: string) => p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')

export default function AgentDefEditor({ agentId, scope }: { agentId: string; scope: 'project' | 'global' }) {
  const [def, setDef] = useState<Def | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const url = `/api/agent-defs/${encodeURIComponent(agentId)}?scope=${scope}`
  const load = (d: Def) => { setDef(d); setText(d.content) }
  useEffect(() => {
    let alive = true
    setDef(null); setMsg(null)
    getJson(url).then((d) => { if (alive) load(d) }).catch((e) => { if (alive) setMsg({ ok: false, text: e.message || 'No pude leer el archivo' }) })
    return () => { alive = false }
  }, [url])
  const run = async (fn: () => Promise<Def>, ok: string) => {
    setBusy(true); setMsg(null)
    try { load(await fn()); setMsg({ ok: true, text: ok }) } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'No se pudo guardar' }) } finally { setBusy(false) }
  }
  const save = () => run(() => put(`/api/human/agent-defs/${encodeURIComponent(agentId)}?scope=${scope}`, { content: text }), 'Guardado. Claude lo usa en las conversaciones nuevas.')
  const reset = () => {
    if (!def?.exists || !confirm(scope === 'project' ? '¿Borrar la copia de este proyecto y volver a la plantilla?' : '¿Borrar la plantilla global y volver al original del plugin?')) return
    void run(() => send('DELETE', `/api/human/agent-defs/${encodeURIComponent(agentId)}?scope=${scope}`), scope === 'project' ? 'Listo: vuelve a usar la plantilla.' : 'Listo: vuelve al original del plugin.')
  }
  const dirty = !!def && text !== def.content
  if (!def) return <p className="text-xs text-muted">{msg?.text ?? 'Leyendo…'}</p>
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${def.exists ? 'bg-blue-soft text-blue' : 'bg-bg text-muted ring-1 ring-line'}`}>{SOURCE[def.source]}</span>
        <code className="truncate">{shortPath(def.file)}</code>
        {!def.exists && <span>· se crea al guardar</span>}
      </div>
      <textarea
        aria-label={`Archivo del agente ${agentId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={12}
        className="resize-y rounded-sm border border-line px-3 py-2 text-xs leading-relaxed outline-none focus:border-blue"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || (!dirty && def.exists)} onClick={() => void save()} className="rounded-full bg-blue px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {def.exists ? 'Guardar' : scope === 'project' ? 'Crear copia del proyecto' : 'Crear plantilla global'}
        </button>
        {dirty && <button type="button" onClick={() => setText(def.content)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-ink">Descartar cambios</button>}
        {def.exists && <button type="button" disabled={busy} onClick={reset} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-red hover:bg-red-soft">{scope === 'project' ? 'Volver a la plantilla' : 'Volver al original'}</button>}
        {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-muted' : 'text-red'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}

/** Plantillas globales (~/.claude/agents): de aquí parten las copias de cada proyecto. */
export function GlobalAgentDefs() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [sel, setSel] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    getJson('/api/agent-defs?scope=global').then((l: Item[]) => { setItems(l); setSel((s) => s || l[0]?.id || '') }).catch((e) => setErr(e.message || 'No pude leer los agentes'))
  }, [])
  if (err) return <p className="text-xs text-red">{err}</p>
  if (!items) return <p className="text-xs text-muted">Leyendo…</p>
  const groups = [...new Set(items.map((i) => i.plugin))]
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Agente</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="rounded-sm border border-line px-3 py-1.5 text-sm sm:max-w-[360px]">
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {items.filter((i) => i.plugin === g).map((i) => <option key={i.id} value={i.id}>{findAgent(i.id)?.name ?? i.id}{i.exists ? ' · editado' : ''}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {sel && <AgentDefEditor key={sel} agentId={sel} scope="global" />}
    </div>
  )
}
