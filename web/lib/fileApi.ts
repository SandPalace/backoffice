// Network layer of the file manager: every call goes through the Back Office server, never straight to disk.
import { SERVER, apiFetch } from './useBackOffice'
import { listingUrl, objectPutUrl, stripSlash, uploadLimitMessage } from './files'
import type { FileEntry, FolderEntry } from './files'

export class ApiError extends Error {
  status: number
  code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

const enc = encodeURIComponent
const base = (ws: string) => `${SERVER}/api/workspaces/${enc(ws)}`

/** Spanish message for the errors people can actually hit. */
export function friendlyError(status: number, fallback: string, size?: number, name?: string): string {
  if (status === 413) return uploadLimitMessage(name ?? 'El archivo', size ?? 0)
  if (status === 409) return 'Ya existe un elemento con ese nombre.'
  if (status === 403) return 'Esa carpeta es de solo lectura: solo puedes modificar "Archivos del equipo".'
  if (status === 404) return 'Ese elemento ya no existe. Actualiza la lista.'
  if (status === 503) return 'El almacenamiento no está disponible por ahora.'
  if (status === 0) return 'No hay conexión con el servidor de Back Office.'
  return fallback
}

async function call(method: string, url: string, body?: unknown): Promise<any> {
  let r: Response
  try {
    r = await apiFetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, friendlyError(0, ''))
  }
  const text = await r.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  if (!r.ok) throw new ApiError(r.status, friendlyError(r.status, json?.message ?? json?.error ?? `HTTP ${r.status}`), json?.error ?? null)
  return json
}

export interface FullListing { files: FileEntry[]; folders: FolderEntry[]; truncated: boolean }

/** Recursive listing of a zone, following cursors (capped to keep the page responsive). */
export async function listAll(ws: string, prefix: string, includeTrash = false, signal?: AbortSignal): Promise<FullListing> {
  const files: FileEntry[] = []
  const folders: FolderEntry[] = []
  let cursor: string | null = null
  let truncated = false
  for (let page = 0; page < 20; page++) {
    let r: Response
    try {
      r = await apiFetch(listingUrl(SERVER, ws, prefix, { recursive: true, cursor, includeTrash, limit: 2000 }), { signal, cache: 'no-store' })
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError(0, friendlyError(0, ''))
    }
    const text = await r.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }
    if (!r.ok) throw new ApiError(r.status, friendlyError(r.status, json?.message ?? json?.error ?? `HTTP ${r.status}`), json?.error ?? null)
    files.push(...json.files)
    folders.push(...json.folders)
    if (!json.truncated || !json.next_cursor) { truncated = false; break }
    cursor = json.next_cursor
    truncated = true
  }
  const seen = new Set<string>()
  return { files: files.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true))), folders, truncated }
}

export const trashKey = (ws: string, key: string): Promise<{ key: string; kind: 'file' | 'folder'; trashed: number; trash_prefix: string }> =>
  call('DELETE', `${base(ws)}/object?key=${enc(stripSlash(key))}`)
export const moveKey = (ws: string, from: string, to: string): Promise<unknown> => call('POST', `${base(ws)}/move`, { from: stripSlash(from), to: stripSlash(to) })
export const createFolder = (ws: string, prefix: string): Promise<unknown> => call('POST', `${base(ws)}/folder`, { prefix: stripSlash(prefix) })
export const importDisk = (ws: string): Promise<unknown> => call('POST', `${base(ws)}/import-disk`, {})

/** Plain-text read for the editor. */
export async function readText(url: string): Promise<string> {
  let r: Response
  try { r = await apiFetch(url, { cache: 'no-store' }) } catch { throw new ApiError(0, friendlyError(0, '')) }
  if (!r.ok) throw new ApiError(r.status, friendlyError(r.status, `No se pudo leer el archivo (HTTP ${r.status}).`))
  return r.text()
}

export async function writeText(ws: string, key: string, text: string, contentType: string): Promise<void> {
  const body = new Blob([text], { type: contentType })
  let r: Response
  try { r = await apiFetch(objectPutUrl(SERVER, ws, key), { method: 'PUT', headers: { 'content-type': contentType }, body }) } catch { throw new ApiError(0, friendlyError(0, '')) }
  if (!r.ok) throw new ApiError(r.status, friendlyError(r.status, `No se pudo guardar (HTTP ${r.status}).`, body.size, key.split('/').pop()))
}

export interface UploadHandle { promise: Promise<void>; abort: () => void }

/** PUT one file with progress; rejects with ApiError (status 409 when overwrite is off and it exists). */
export function putFile(ws: string, key: string, file: Blob, contentType: string, overwrite: boolean, onProgress: (loaded: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open('PUT', objectPutUrl(SERVER, ws, key, overwrite))
    xhr.withCredentials = true
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let msg = `HTTP ${xhr.status}`
      try { const j = JSON.parse(xhr.responseText); msg = j.message ?? j.error ?? msg } catch { /* ignore */ }
      reject(new ApiError(xhr.status, friendlyError(xhr.status, msg, file.size, key.split('/').pop()), xhr.status === 409 ? 'exists' : null))
    }
    xhr.onerror = () => reject(new ApiError(0, friendlyError(0, '')))
    xhr.onabort = () => reject(new ApiError(-1, 'Cancelado'))
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

// ---- trash restore ---------------------------------------------------------------------------------------
// Restore is a move from trash/<ts>/<key> back to <key>. Servers that only allow moving keys under files/
// answer 403 forbidden_key; then we copy through the server (GET + PUT) and remember the item as restored
// so the trash view hides it (trash/ itself cannot be modified from the web).

const RESTORED_KEY = (ws: string) => `backoffice.restored.${ws}`
export function restoredSet(ws: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(RESTORED_KEY(ws)) ?? '[]')) } catch { return new Set() }
}
function markRestored(ws: string, trashKeyPath: string) {
  try {
    const s = restoredSet(ws); s.add(trashKeyPath)
    localStorage.setItem(RESTORED_KEY(ws), JSON.stringify([...s].slice(-500)))
  } catch { /* storage blocked: the item just stays visible in trash */ }
}

export async function restoreFromTrash(ws: string, trashFrom: string, dest: string): Promise<void> {
  try {
    await moveKey(ws, trashFrom, dest)
    return
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 403) throw e
  }
  const from = stripSlash(trashFrom)
  const to = stripSlash(dest)
  const l = await listAll(ws, from + '/', true)
  const items = l.files.length ? l.files.map((f) => ({ src: f.key, dst: to + f.key.slice(from.length), type: f.content_type })) : [{ src: from, dst: to, type: '' }]
  for (const it of items) {
    let r: Response
    try { r = await apiFetch(`${base(ws)}/object?key=${enc(it.src)}`, { cache: 'no-store' }) } catch { throw new ApiError(0, friendlyError(0, '')) }
    if (!r.ok) throw new ApiError(r.status, friendlyError(r.status, `No se pudo leer el archivo de la papelera (HTTP ${r.status}).`))
    const blob = await r.blob()
    const type = it.type || r.headers.get('content-type') || 'application/octet-stream'
    const w = await apiFetch(objectPutUrl(SERVER, ws, it.dst, false), { method: 'PUT', headers: { 'content-type': type.split(';')[0] }, body: blob })
    if (!w.ok) throw new ApiError(w.status, friendlyError(w.status, `No se pudo restaurar (HTTP ${w.status}).`))
  }
  markRestored(ws, from)
}
