'use client'
import { useEffect, useRef, useState } from 'react'
import { MarkdownPage } from './FileViewer'
import { MAX_EDIT_BYTES, formatSize, previewKind } from '@/lib/files'
import { readText, writeText } from '@/lib/fileApi'
import { getCurrentWorkspace } from '@/lib/useBackOffice'

/**
 * Inline editor for text-like files. Keeps the text it loaded (`base`); on save it re-reads the file and, if it
 * is different (an agent or another tab changed it meanwhile), asks before overwriting.
 */
export default function TextEditor({ url, fileKey, name, contentType, size, onDirty, onCancel, onSaved }: {
  url: string; fileKey: string; name: string; contentType: string; size: number
  onDirty: (d: boolean) => void; onCancel: () => void; onSaved: () => void
}) {
  const tooBig = size > MAX_EDIT_BYTES
  const [base, setBase] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null) // text the other writer left
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const area = useRef<HTMLTextAreaElement>(null)
  const kind = previewKind(contentType, name)
  const dirty = base !== null && draft !== base

  useEffect(() => {
    if (tooBig) return
    let dead = false
    readText(url).then((t) => { if (!dead) { setBase(t); setDraft(t) } }).catch((e) => { if (!dead) setErr(e.message) })
    return () => { dead = true }
  }, [url, tooBig])
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  useEffect(() => { if (base !== null) area.current?.focus() }, [base])

  const bytes = new Blob([draft]).size
  const overCap = bytes > MAX_EDIT_BYTES

  const doSave = async (force: boolean) => {
    if (base === null || overCap) return
    setSaving(true); setErr(null)
    try {
      if (!force) {
        const current = await readText(url)
        if (current !== base) { setConflict(current); return }
      }
      await writeText(getCurrentWorkspace(), fileKey, draft, contentType.split(';')[0] || 'text/plain')
      onDirty(false)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally { setSaving(false) }
  }

  if (tooBig) return <p role="alert" className="p-5 text-sm text-red">Este archivo pesa {formatSize(size)} y es demasiado grande para editarlo aquí (máximo {formatSize(MAX_EDIT_BYTES)}). Descárgalo, edítalo y vuelve a subirlo.</p>
  if (err && base === null) return <p role="alert" className="p-5 text-sm text-red">{err}</p>
  if (base === null) return <p role="status" className="p-5 text-sm text-muted">Cargando…</p>

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty && !saving) doSave(false) }
  }
  return (
    <div className="flex h-full flex-col" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex items-center gap-1 text-xs font-semibold" role="tablist" aria-label="Modo del editor">
          <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={`rounded-full px-3 py-1 ${tab === 'edit' ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>Editar</button>
          {kind === 'markdown' && <button role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={`rounded-full px-3 py-1 ${tab === 'preview' ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>Vista previa</button>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] ${overCap ? 'text-red' : 'text-muted'}`}>{dirty ? 'Cambios sin guardar · ' : ''}{formatSize(bytes)} de {formatSize(MAX_EDIT_BYTES)}</span>
          <button onClick={onCancel} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Cancelar</button>
          <button onClick={() => doSave(false)} disabled={!dirty || saving || overCap} className="rounded-full bg-blue px-4 py-1 text-xs font-semibold text-white disabled:opacity-40">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
      {conflict !== null && (
        <div role="alertdialog" aria-label="Conflicto de edición" className="border-b border-line bg-amber-soft px-4 py-3 text-xs">
          <div className="font-semibold">Alguien (probablemente un agente) cambió este archivo mientras lo editabas.</div>
          <p className="mt-1">Si guardas, se reemplaza su versión por la tuya. También puedes cargar su versión y perder tus cambios.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => { setConflict(null); doSave(true) }} className="rounded-full bg-red px-3 py-1 font-semibold text-white">Guardar la mía</button>
            <button onClick={() => { setBase(conflict); setDraft(conflict); setConflict(null) }} className="rounded-full border border-line bg-surface px-3 py-1 font-semibold">Cargar la versión nueva</button>
            <button onClick={() => setConflict(null)} className="rounded-full border border-line bg-surface px-3 py-1 font-semibold">Seguir editando</button>
          </div>
        </div>
      )}
      {err && <p role="alert" className="border-b border-line bg-red-soft px-4 py-2 text-xs text-red">{err}</p>}
      {tab === 'preview' && kind === 'markdown'
        ? <div className="min-h-[50vh] flex-1 overflow-auto"><MarkdownPage text={draft} /></div>
        : <textarea
            ref={area} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={kind !== 'html'} aria-label={`Contenido de ${name}`}
            className="min-h-[55vh] w-full flex-1 resize-none border-0 bg-surface p-4 font-mono text-[13px] leading-relaxed outline-none"
          />}
    </div>
  )
}
