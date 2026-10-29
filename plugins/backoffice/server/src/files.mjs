// Virtual file layer on top of the blob store. Everything a person or an agent works on lives in the
// workspace bucket (`ws-<id>`) and is addressed by key, never by a disk path:
//   files/<path>              working files (agents: workspace-relative `marketing/acme/facts.md`)
//   outputs/<task_id>/...     deliveries
//   trash/<ts>/<key>          soft-deleted objects
// Folders are implicit (key prefixes); `files/<dir>/.keep` is an empty-folder marker hidden from listings.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultWorkspaceRoot } from './paths.mjs'
import { AppError, bucketOf } from './store.mjs'
import { assertBlobKey, readStream, BlobError } from './blobstore.mjs'
import { contentTypeOf } from './outputs-storage.mjs'

export const FILES = 'files/'
export const OUTPUTS = 'outputs/'
export const TRASH = 'trash/'
export const KEEP = '.keep'

export const DEFAULT_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024, // one object
  maxReadBytes: 5 * 1024 * 1024, // backoffice_file_read
  maxListPage: 5000, // entries per listing page
  maxScan: 20000, // objects examined per listing
  maxFolderOps: 5000, // files moved/trashed/zipped in one call
  maxZipBytes: 1024 * 1024 * 1024,
  maxDeliverFiles: 100,
  maxImportFiles: 5000,
  maxImportBytes: 2 * 1024 * 1024 * 1024,
}

const CTRL = /[\x00-\x1f\x7f]/
const isKeep = (key) => key === KEEP || key.endsWith('/' + KEEP)
const baseName = (key) => key.slice(key.lastIndexOf('/') + 1)
const ensureSlash = (p) => (p === '' || p.endsWith('/') ? p : p + '/')
const stripSlash = (p) => p.replace(/\/+$/, '')

export function createFiles({ store, blobs, limits: custom = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...custom }
  const bucket = (ws) => bucketOf(ws)

  // ── paths ──
  // Agents may still send legacy text: `~/AgentOS/x`, `/Users/me/AgentOS/workspaces/acme/x`, `/x`. All map to the same relative path.
  function normalizeRel(ws, raw, { allowEmpty = false } = {}) {
    if (typeof raw !== 'string') throw new AppError('bad_path', 'path must be a string')
    let p = raw.trim().replace(/\\/g, '/')
    let legacy = false
    const roots = [store.getWorkspace(ws)?.root, defaultWorkspaceRoot(), join(homedir(), 'AgentOS')]
      .filter(Boolean).map((r) => r.replace(/\\/g, '/').replace(/\/+$/, '')).sort((a, b) => b.length - a.length)
    if (/^~\/AgentOS(\/|$)/.test(p)) { p = p.replace(/^~\/AgentOS/, ''); legacy = true }
    else for (const r of roots) if (p === r || p.startsWith(r + '/') || (process.platform === 'win32' && (p.toLowerCase() === r.toLowerCase() || p.toLowerCase().startsWith(r.toLowerCase() + '/')))) { p = p.slice(r.length); legacy = true; break }
    p = p.replace(/^\/+/, '')
    if (legacy) p = p.replace(new RegExp(`^workspaces/${ws.replace(/[^a-z0-9-]/g, '')}(?=/|$)`), '').replace(/^\/+/, '')
    const segs = []
    for (const s of p.split('/')) {
      if (s === '' || s === '.') continue
      if (s === '..') throw new AppError('bad_path', 'Paths cannot contain ..', 400)
      if (CTRL.test(s) || Buffer.byteLength(s) > 240) throw new AppError('bad_path', 'Invalid path segment', 400)
      segs.push(s)
    }
    const out = segs.join('/')
    if (out.length > 1000) throw new AppError('bad_path', 'Path too long', 400)
    if (!out && !allowEmpty) throw new AppError('bad_path', 'Path is empty', 400)
    return out
  }
  const keyOfRel = (rel) => FILES + rel

  // The web sends full keys; it may only modify the `files/` area.
  function userKey(key, { allowFolderRoot = false } = {}) {
    if (typeof key !== 'string') throw new AppError('bad_path', 'key is required', 400)
    const k = stripSlash(key)
    assertBlobKey(k)
    if (!k.startsWith(FILES) || (k === 'files' && !allowFolderRoot)) throw new AppError('forbidden_key', 'Only keys under files/ can be modified', 403)
    return k
  }

  // Restore source: only `trash/<ts>/files/...` (what soft delete produced) may be moved back, and only into `files/`.
  function trashKey(key) {
    if (typeof key !== 'string') throw new AppError('bad_path', 'key is required', 400)
    const k = stripSlash(key)
    assertBlobKey(k)
    if (!/^trash\/[0-9]+\/files\/.+/.test(k)) throw new AppError('forbidden_key', 'Only trashed items under trash/<ts>/files/ can be restored', 403)
    return k
  }

  // ── primitives on full keys ──
  async function putKey(ws, key, buf, { contentType, overwrite = true, op = 'put' } = {}) {
    assertBlobKey(key)
    if (buf.length > limits.maxFileBytes) throw new AppError('too_large', `File is larger than the ${limits.maxFileBytes} byte limit`, 413)
    const b = bucket(ws)
    const prev = await blobs.head(b, key)
    if (prev && !overwrite) throw new AppError('exists', `A file already exists at ${key}; pass overwrite: true to replace it`, 409)
    const type = contentType || contentTypeOf(key)
    const r = await blobs.put(b, key, buf, type)
    store.emitFiles(ws, { op, key, count: 1 })
    return { key, size: r.size, sha256: r.sha256, content_type: type, created: !prev, overwritten: !!prev, backend: r.backend }
  }

  // Reads an object (<= read cap). With an explicit maxBytes smaller than the object, returns only the first bytes (truncated).
  async function readKey(ws, key, { maxBytes = null } = {}) {
    assertBlobKey(key)
    const explicit = Number(maxBytes) > 0 ? Math.min(Number(maxBytes), limits.maxReadBytes) : null
    const b = bucket(ws)
    const h = await blobs.head(b, key)
    const o = h && (await blobs.get(b, key))
    if (!o) throw new AppError('not_found', `No such file: ${key}`, 404)
    const size = h.size ?? o.size
    if (!explicit && size != null && size > limits.maxReadBytes) { o.stream.destroy?.(); throw new AppError('too_large', `File is ${size} bytes; the read limit is ${limits.maxReadBytes} bytes (5 MB). Pass max_bytes to read the beginning of a text file.`, 413) }
    const want = explicit ?? limits.maxReadBytes
    const chunks = []
    let n = 0
    for await (const c of o.stream) {
      chunks.push(c)
      n += c.length
      if (n > want) { o.stream.destroy?.(); break }
    }
    let buf = Buffer.concat(chunks)
    const truncated = buf.length > want || (size != null && size > want)
    if (buf.length > want) buf = buf.subarray(0, want)
    return { buf, size: size ?? buf.length, truncated, contentType: o.contentType || h.contentType || contentTypeOf(key) }
  }

  const listAll = async (ws, prefix, { delimiter, max = limits.maxScan } = {}) => blobs.list(bucket(ws), prefix, { delimiter, max })

  // Listing page for the web / agents. recursive=false: folders + files of one level.
  async function listPage(ws, { prefix = '', recursive = false, limit, cursor = '', includeTrash = false } = {}) {
    const lim = Math.min(Math.max(1, Number(limit) || limits.maxListPage), limits.maxListPage)
    const res = await listAll(ws, prefix, { delimiter: recursive ? undefined : '/' })
    const hideTrash = (k) => includeTrash || !k.startsWith(TRASH) || prefix.startsWith(TRASH)
    const objs = res.objects.filter((o) => !isKeep(o.key) && hideTrash(o.key))
    let folders = []
    if (recursive) {
      const set = new Set()
      for (const o of res.objects) {
        if (!hideTrash(o.key)) continue
        let i = o.key.indexOf('/', prefix.lastIndexOf('/') + 1)
        while (i !== -1) { set.add(o.key.slice(0, i + 1)); i = o.key.indexOf('/', i + 1) }
      }
      folders = [...set].filter((f) => f.startsWith(prefix) && f !== prefix)
    } else folders = res.prefixes.filter(hideTrash)
    const base = prefix.slice(0, prefix.lastIndexOf('/') + 1)
    const nameOf = (k) => k.slice(recursive ? prefix.length : base.length)
    const entries = [
      ...folders.map((p) => ({ type: 'folder', k: p, v: { prefix: p, name: stripSlash(nameOf(p)) } })),
      ...objs.map((o) => ({ type: 'file', k: o.key, v: { key: o.key, name: nameOf(o.key), size: o.size, last_modified: o.lastModified, content_type: o.contentType || contentTypeOf(o.key) } })),
    ].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    const after = cursor ? entries.filter((e) => e.k > cursor) : entries
    const page = after.slice(0, lim)
    return {
      folders: page.filter((e) => e.type === 'folder').map((e) => e.v),
      files: page.filter((e) => e.type === 'file').map((e) => e.v),
      next_cursor: after.length > lim ? page.at(-1).k : null,
      truncated: !!res.truncated,
    }
  }

  // File or folder? Returns the object keys that `key` designates.
  async function keysOf(ws, key) {
    const b = bucket(ws)
    if (await blobs.head(b, key)) return { kind: 'file', keys: [key] }
    const r = await listAll(ws, key + '/', { max: limits.maxFolderOps + 1 })
    if (!r.objects.length) throw new AppError('not_found', `No such file or folder: ${key}`, 404)
    if (r.objects.length > limits.maxFolderOps) throw new AppError('too_large', `Folder has more than ${limits.maxFolderOps} files`, 413)
    return { kind: 'folder', keys: r.objects.map((o) => o.key) }
  }

  // Soft delete: nothing is erased, objects move to trash/<ts>/<key>.
  async function softDelete(ws, key) {
    const { kind, keys } = await keysOf(ws, key)
    const b = bucket(ws)
    const ts = Date.now()
    for (const k of keys) {
      await blobs.copy(b, k, `${TRASH}${ts}/${k}`)
      await blobs.delete(b, k)
    }
    store.emitFiles(ws, { op: 'delete', key, count: keys.length })
    return { key, kind, trashed: keys.length, trash_prefix: `${TRASH}${ts}/${key}` }
  }

  async function move(ws, from, to) {
    if (from === to) return { from, to, moved: 0, kind: 'file' }
    const b = bucket(ws)
    const { kind, keys } = await keysOf(ws, from)
    if (kind === 'file') {
      if (await blobs.head(b, to)) throw new AppError('exists', `Destination already exists: ${to}`, 409)
      const dirClash = await listAll(ws, to + '/', { max: 1 })
      if (dirClash.objects.length) throw new AppError('exists', `Destination is a folder: ${to}`, 409)
      await blobs.copy(b, from, to)
      await blobs.delete(b, from)
    } else {
      if ((to + '/').startsWith(from + '/')) throw new AppError('bad_move', 'Cannot move a folder into itself', 400)
      const pairs = keys.map((k) => [k, to + k.slice(from.length)])
      for (const [, d] of pairs) if (await blobs.head(b, d)) throw new AppError('exists', `Destination already exists: ${d}`, 409)
      for (const [s, d] of pairs) { await blobs.copy(b, s, d); await blobs.delete(b, s) }
    }
    store.emitFiles(ws, { op: 'move', from, to, count: keys.length })
    return { from, to, moved: keys.length, kind }
  }

  async function makeFolder(ws, prefix) {
    const k = userKey(prefix, { allowFolderRoot: false })
    const marker = `${k}/${KEEP}`
    const b = bucket(ws)
    if (await blobs.head(b, k)) throw new AppError('exists', `A file already exists at ${k}`, 409)
    await blobs.put(b, marker, Buffer.alloc(0), 'text/plain; charset=utf-8')
    store.emitFiles(ws, { op: 'folder', key: k + '/', count: 1 })
    return { prefix: k + '/' }
  }

  // Entries for the ZIP of a folder (keys under `prefix`), with caps.
  async function zipPlan(ws, prefix) {
    const p = ensureSlash(prefix)
    const r = await listAll(ws, p, { max: limits.maxFolderOps + 1 })
    if (r.objects.length > limits.maxFolderOps) throw new AppError('too_large', `Folder has more than ${limits.maxFolderOps} files`, 413)
    const objs = r.objects.filter((o) => !(prefix.startsWith(FILES) && o.key.startsWith(TRASH)))
    const total = objs.reduce((n, o) => n + o.size, 0)
    if (total > limits.maxZipBytes) throw new AppError('too_large', `Folder is larger than ${limits.maxZipBytes} bytes`, 413)
    if (!objs.length) throw new AppError('not_found', 'That folder is empty or does not exist', 404)
    const label = stripSlash(p).split('/').pop() || 'files'
    return { p, label, objs }
  }
  async function* zipEntries(ws, plan) {
    const b = bucket(ws)
    const dirs = new Set()
    for (const o of plan.objs) {
      const rel = o.key.slice(plan.p.length)
      const parts = rel.split('/')
      parts.pop()
      let acc = ''
      for (const part of parts) { acc += part + '/'; if (!dirs.has(acc)) { dirs.add(acc); yield { name: `${plan.label}/${acc}`, mtime: new Date() } } }
      if (isKeep(o.key)) continue
      const obj = await blobs.get(b, o.key)
      if (!obj) continue
      yield { name: `${plan.label}/${rel}`, mtime: o.lastModified ? new Date(o.lastModified) : new Date(), stream: obj.stream }
    }
  }

  // ── backoffice_task_deliver with virtual files ──
  async function deliverVirtual(ws, taskId, body = {}) {
    const entries = body.files
    if (!Array.isArray(entries) || !entries.length) throw new AppError('bad_request', 'files must be a non-empty list', 400)
    if (entries.length > limits.maxDeliverFiles) throw new AppError('too_large', `At most ${limits.maxDeliverFiles} files per delivery`, 413)
    const b = bucket(ws)
    // Phase 1: resolve everything (fail before creating any output row).
    const plan = []
    for (const e of entries) {
      if (e && typeof e === 'object' && typeof e.path === 'string') {
        const rel = normalizeRel(ws, e.path)
        const key = keyOfRel(rel)
        if (await blobs.head(b, key)) plan.push({ type: 'file', key, name: baseName(key), e })
        else {
          const r = await listAll(ws, key + '/', { max: limits.maxFolderOps + 1 })
          const objs = r.objects.filter((o) => !isKeep(o.key))
          if (!objs.length) throw new AppError('not_found', `No such file or folder in workspace storage: ${rel}`, 404)
          if (r.objects.length > limits.maxFolderOps) throw new AppError('too_large', `Folder has more than ${limits.maxFolderOps} files`, 413)
          plan.push({ type: 'folder', key, name: baseName(key), objs, e })
        }
      } else if (e && typeof e === 'object' && typeof e.name === 'string' && (typeof e.content === 'string' || typeof e.content_base64 === 'string')) {
        if (e.name.includes('/') || e.name.includes('\\') || CTRL.test(e.name) || !e.name.trim() || e.name === '.' || e.name === '..' || Buffer.byteLength(e.name) > 240) throw new AppError('bad_path', `Invalid file name: ${e.name}`, 400)
        const buf = typeof e.content_base64 === 'string' ? Buffer.from(e.content_base64, 'base64') : Buffer.from(e.content, 'utf8')
        if (buf.length > limits.maxFileBytes) throw new AppError('too_large', `${e.name} is larger than the file limit`, 413)
        plan.push({ type: 'inline', name: e.name, buf, e })
      } else throw new AppError('bad_request', 'Each entry needs {path} (a workspace file or folder) or {name, content|content_base64}', 400)
    }
    // Phase 2: copy/write into outputs/<task>/ and create the rows.
    for (const item of plan) {
      const kind = item.e.kind && ['file', 'folder', 'report', 'image', 'markdown', 'artifact'].includes(item.e.kind) ? item.e.kind : item.type === 'folder' ? 'folder' : body.kind && body.kind !== 'link' && body.kind !== 'folder' ? body.kind : 'file'
      const title = item.e.title ?? (entries.length === 1 ? body.title : null) ?? item.name
      const id = store.addVirtualOutput(taskId, { kind, title, session_id: body.session_id ?? null }, ws)
      try {
        if (item.type === 'folder') {
          let prefix = `${OUTPUTS}${taskId}/${item.name}/`
          if (store.keyTaken(taskId, id, prefix)) prefix = `${OUTPUTS}${taskId}/${id}/${item.name}/`
          const files = []
          for (const o of item.objs) {
            const rel = o.key.slice(item.key.length + 1)
            const r = await blobs.copy(b, o.key, prefix + rel)
            files.push({ rel, key: prefix + rel, size: r.size, content_type: r.contentType, sha256: r.sha256 })
          }
          store.setOutputStorage(id, { bucket: b, storage_key: prefix, size: files.reduce((n, f) => n + f.size, 0), uploaded_at: Date.now(), files: { files, skipped: [] } })
        } else {
          let key = `${OUTPUTS}${taskId}/${item.name}`
          if (store.keyTaken(taskId, id, key)) key = `${OUTPUTS}${taskId}/${id}/${item.name}`
          let m
          if (item.type === 'file') m = await blobs.copy(b, item.key, key)
          else {
            const ct = item.e.content_type || (typeof item.e.content === 'string' && contentTypeOf(item.name) === 'application/octet-stream' ? 'text/plain; charset=utf-8' : contentTypeOf(item.name))
            const r = await blobs.put(b, key, item.buf, ct)
            m = { size: r.size, sha256: r.sha256, contentType: ct }
          }
          store.setOutputStorage(id, { bucket: b, storage_key: key, size: m.size, content_type: m.contentType, sha256: m.sha256, uploaded_at: Date.now() })
        }
      } catch (e) {
        store.setOutputStorage(id, { storage_error: String(e?.message ?? e).slice(0, 200) })
        throw e
      }
    }
    return store.getTask(taskId)
  }

  return { limits, normalizeRel, keyOfRel, userKey, trashKey, putKey, readKey, listPage, keysOf, softDelete, move, makeFolder, zipPlan, zipEntries, deliverVirtual }
}
