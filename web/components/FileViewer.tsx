'use client'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import TextEditor from './TextEditor'
import { formatSize, outputFileUrl, parseCsv, previewKind, safeLink } from '@/lib/files'
import { SERVER, apiFetch, getCurrentWorkspace } from '@/lib/useBackOffice'
import type { Output, OutputFiles } from '@/lib/types'

export interface ViewerFile {
  name: string
  contentType: string
  size?: number | null
  url: string
  downloadUrl: string
}

const MAX_CHARS = 300_000

/** Inline markdown: **bold**, *italic*, `code`, [text](http-url). No HTML is ever injected. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const t = m[0]
    const k = `${key}-${i++}`
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) out.push(<code key={k} className="rounded-sm bg-bg px-1 font-mono text-[12px]">{t.slice(1, -1)}</code>)
    else if (t.startsWith('[')) {
      const [, label, href] = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(t)!
      const safe = safeLink(href)
      out.push(safe ? <a key={k} href={safe} target="_blank" rel="noopener noreferrer" className="text-blue underline">{label}</a> : <Fragment key={k}>{label}</Fragment>)
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Vista previa de un documento como hoja: papel centrado sobre fondo gris, con alto mínimo de página aunque tenga pocas líneas. */
export function MarkdownPage({ text }: { text: string }) {
  return (
    <div className="bg-bg px-3 py-5 sm:px-6">
      <article className="mx-auto min-h-[70vh] w-full max-w-[780px] rounded-sm border border-line bg-surface px-6 py-8 sm:px-12 sm:py-10">
        <Markdown text={text} />
      </article>
    </div>
  )
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: React.ReactNode[] = []
  let i = 0
  let n = 0
  while (i < lines.length) {
    const l = lines[i]
    const key = `b${n++}`
    if (/^```/.test(l)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++])
      i++
      blocks.push(<pre key={key} className="overflow-x-auto rounded-sm bg-bg p-3 font-mono text-[12px] leading-relaxed">{buf.join('\n')}</pre>)
    } else if (/^#{1,6}\s/.test(l)) {
      const lvl = /^#+/.exec(l)![0].length
      const cls = lvl === 1 ? 'text-xl font-extrabold' : lvl === 2 ? 'text-base font-bold' : 'text-sm font-bold'
      blocks.push(<div key={key} role="heading" aria-level={lvl} className={`${cls} mt-2`}>{inline(l.replace(/^#+\s*/, ''), key)}</div>)
      i++
    } else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s/, ''))
      const Tag = ordered ? 'ol' : 'ul'
      blocks.push(<Tag key={key} className={`${ordered ? 'list-decimal' : 'list-disc'} flex flex-col gap-1 pl-5`}>{items.map((it, j) => <li key={j}>{inline(it, `${key}-${j}`)}</li>)}</Tag>)
    } else if (l.trim() === '') i++
    else {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++])
      blocks.push(<p key={key}>{inline(buf.join(' '), key)}</p>)
    }
  }
  return <div className="flex flex-col gap-3 text-sm leading-relaxed">{blocks}</div>
}

function CsvTable({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = parseCsv(text, delimiter).slice(0, 500)
  if (!rows.length) return <p className="text-sm text-muted">El archivo está vacío.</p>
  const [head, ...body] = rows
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead><tr>{head.map((h, i) => <th key={i} scope="col" className="sticky top-0 whitespace-nowrap border-b border-line bg-bg px-3 py-1.5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i} className="border-b border-line">{r.map((c, j) => <td key={j} className="px-3 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** `frameClass`: alto del iframe de html/pdf (por defecto 70vh; el Inicio lo estira a la pantalla). */
export function Preview({ file, rev = 0, frameClass = 'h-[70vh]' }: { file: ViewerFile; rev?: number; frameClass?: string }) {
  const kind = previewKind(file.contentType, file.name)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const needsText = kind === 'markdown' || kind === 'text' || kind === 'csv'
  useEffect(() => {
    setText(null); setErr(null)
    if (!needsText) return
    const ac = new AbortController()
    apiFetch(file.url, { signal: ac.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 503 ? 'El almacenamiento no está disponible.' : r.status === 404 ? 'El archivo ya no existe.' : `No se pudo leer el archivo (HTTP ${r.status}).`)
        return r.text()
      })
      .then(setText)
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message) })
    return () => ac.abort()
  }, [file.url, needsText, rev])

  if (kind === 'image') return <div className="flex min-h-[200px] items-center justify-center bg-bg p-3"><img key={rev} src={file.url} alt={file.name} className="max-h-[70vh] max-w-full object-contain" /></div>
  if (kind === 'html') return <iframe key={rev} title={file.name} src={file.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className={`${frameClass} w-full border-0 bg-white`} />
  if (kind === 'pdf') return <iframe title={file.name} src={file.url} className={`${frameClass} w-full border-0 bg-white`} />
  if (kind === 'none') return <p className="p-5 text-sm text-muted">No hay vista previa para este tipo de archivo. Puedes descargarlo.</p>
  if (err) return <p role="alert" className="p-5 text-sm text-red">{err}</p>
  if (text === null) return <p className="p-5 text-sm text-muted" role="status">Cargando…</p>
  const clipped = text.length > MAX_CHARS
  const body = clipped ? text.slice(0, MAX_CHARS) : text
  return (
    <div className={kind === 'markdown' ? '' : 'p-5'}>
      {kind === 'markdown' && <MarkdownPage text={body} />}
      {kind === 'csv' && <CsvTable text={body} delimiter={/\.tsv$/i.test(file.name) ? '\t' : ','} />}
      {kind === 'text' && <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed">{body}</pre>}
      {clipped && <p className={`mt-3 text-xs text-muted ${kind === 'markdown' ? 'px-5 pb-4' : ''}`}>Se muestra el principio del archivo. Descárgalo para verlo completo.</p>}
    </div>
  )
}

export interface EditConfig { key: string; contentType: string; onSaved: () => void }

export function FileViewer({ title, files, onClose, error, loading, edit }: { title: string; files: ViewerFile[]; onClose: () => void; error?: string | null; loading?: boolean; edit?: EditConfig }) {
  const [sel, setSel] = useState(0)
  const [editing, setEditing] = useState(false)
  const [rev, setRev] = useState(0)
  const [confirm, setConfirm] = useState<'close' | 'cancel' | null>(null)
  const dirtyRef = useRef(false)
  const file = files[Math.min(sel, files.length - 1)]
  const setDirty = useCallback((d: boolean) => { dirtyRef.current = d }, [])
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])
  const requestClose = () => { if (editing && dirtyRef.current) setConfirm('close'); else onClose() }
  const requestCancel = () => { if (dirtyRef.current) setConfirm('cancel'); else { setEditing(false); requestAnimationFrame(() => document.getElementById('fv-edit')?.focus()) } }
  const refocus = () => requestAnimationFrame(() => document.getElementById('fv-edit')?.focus())
  const discard = () => { dirtyRef.current = false; const c = confirm; setConfirm(null); if (c === 'close') onClose(); else { setEditing(false); refocus() } }
  return (
    <Modal title={`${editing ? 'Editar' : 'Vista previa'}: ${title}`} onClose={requestClose} wide>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="label">{editing ? 'Editando' : 'Vista previa'}</div>
          <div className="truncate text-sm font-bold">{file && files.length > 1 ? `${title} / ${file.name}` : title}</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {edit && !editing && file && <button id="fv-edit" onClick={() => setEditing(true)} className="rounded-full bg-blue px-3 py-1 text-xs font-semibold text-white hover:opacity-90">Editar</button>}
          {file && <a href={file.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Abrir</a>}
          {file && <a href={file.downloadUrl} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:bg-bg">Descargar</a>}
          <button onClick={requestClose} className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-bg">Cerrar · Esc</button>
        </div>
      </div>
      {confirm && (
        <div role="alertdialog" aria-label="Cambios sin guardar" className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-amber-soft px-4 py-2 text-xs">
          <span className="font-semibold">Tienes cambios sin guardar. Si sales, se pierden.</span>
          <span className="flex gap-2">
            <button onClick={() => setConfirm(null)} className="rounded-full border border-line bg-surface px-3 py-1 font-semibold">Seguir editando</button>
            <button onClick={discard} className="rounded-full bg-red px-3 py-1 font-semibold text-white">Descartar cambios</button>
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {files.length > 1 && (
          <ul className="max-h-[70vh] w-[220px] flex-none overflow-y-auto border-r border-line p-2" aria-label="Archivos de la carpeta">
            {files.map((f, i) => (
              <li key={f.name}>
                <button onClick={() => setSel(i)} aria-current={i === sel} className={`w-full rounded-sm px-2 py-1.5 text-left text-xs ${i === sel ? 'bg-blue-soft font-semibold text-blue' : 'hover:bg-bg'}`}>
                  <span className="block truncate">{f.name}</span>
                  <span className="text-[10px] text-muted">{formatSize(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="min-w-0 flex-1 overflow-auto">
          {loading ? <p className="p-5 text-sm text-muted" role="status">Cargando archivos…</p>
            : error ? <p role="alert" className="p-5 text-sm text-red">{error}</p>
            : !file ? <p className="p-5 text-sm text-muted">Esta carpeta no tiene archivos.</p>
            : editing && edit ? (
              <TextEditor
                url={file.url} fileKey={edit.key} name={file.name} contentType={edit.contentType} size={file.size ?? 0}
                onDirty={setDirty} onCancel={requestCancel}
                onSaved={() => { dirtyRef.current = false; setEditing(false); setRev((r) => r + 1); edit.onSaved(); refocus() }}
              />
            )
            : <Preview file={file} rev={rev} />}
        </div>
      </div>
    </Modal>
  )
}

/** Viewer for a delivery: single file, or every file of a folder output (listed through the API). */
export function OutputViewer({ output, onClose }: { output: Output; onClose: () => void }) {
  const ws = getCurrentWorkspace()
  const [files, setFiles] = useState<ViewerFile[] | null>(output.kind === 'folder' ? null : [])
  const [error, setError] = useState<string | null>(null)
  const title = output.title ?? (output.path ?? output.storage_key ?? '').split('/').filter(Boolean).pop() ?? `Entrega ${output.id}`
  useEffect(() => {
    if (output.kind !== 'folder') {
      setFiles([{ name: title, contentType: output.content_type ?? '', size: output.size, url: outputFileUrl(SERVER, ws, output.id), downloadUrl: outputFileUrl(SERVER, ws, output.id, { download: true }) }])
      return
    }
    let dead = false
    apiFetch(`${SERVER}/api/outputs/${output.id}/files?workspace=${encodeURIComponent(ws)}`)
      .then(async (r) => { if (!r.ok) throw new Error(`No se pudo listar la carpeta (HTTP ${r.status}).`); return (await r.json()) as OutputFiles })
      .then((d) => { if (!dead) setFiles(d.files.map((f) => ({ name: f.rel, contentType: f.content_type, size: f.size, url: outputFileUrl(SERVER, ws, output.id, { file: f.rel }), downloadUrl: outputFileUrl(SERVER, ws, output.id, { file: f.rel, download: true }) }))) })
      .catch((e) => { if (!dead) { setError(e.message); setFiles([]) } })
    return () => { dead = true }
  }, [output.id, output.kind, output.content_type, output.size, title, ws])
  return <FileViewer title={title} files={files ?? []} loading={files === null} error={error} onClose={onClose} />
}
