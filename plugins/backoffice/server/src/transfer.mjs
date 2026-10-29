// Background job: importDisk. Ingest a workspace folder from disk as files/<relative path> (idempotent, never overwrites)
import { readFile, readdir, lstat, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { AppError, bucketOf } from './store.mjs'
import { assertBlobKey } from './blobstore.mjs'
import { contentTypeOf } from './outputs-storage.mjs'
import { FILES, KEEP } from './files.mjs'
import { pathInside } from './paths.mjs'

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist'])
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const short = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MAX_ERRORS = 50

export function createTransfer({ store, blobs, limits, allowedRoots }) {
  const importState = { running: false, workspace: null, total: 0, imported: 0, skipped_existing: 0, skipped_other: 0, failed: 0, bytes: 0, started_at: null, finished_at: null, errors: [] }

  // ───────── import-disk ─────────
  async function walk(root, skipRoots, cap) {
    const files = []
    const skipped = []
    let bytes = 0
    async function visit(dir, rel) {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { skipped.push({ rel: rel || '.', reason: 'unreadable' }); return }
      entries.sort((a, b) => (a.name < b.name ? -1 : 1))
      for (const e of entries) {
        if (files.length >= limits.maxImportFiles || bytes >= limits.maxImportBytes) { cap.hit = true; return }
        const r = rel ? `${rel}/${e.name}` : e.name
        const abs = join(dir, e.name)
        if (e.isSymbolicLink()) skipped.push({ rel: r, reason: 'symlink' })
        else if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) skipped.push({ rel: r + '/', reason: 'ignored_dir' })
          else if (skipRoots.has(resolve(abs))) skipped.push({ rel: r + '/', reason: 'other_workspace' })
          else await visit(abs, r)
        } else if (e.isFile()) {
          if (SKIP_FILES.has(e.name) || e.name.startsWith('~$')) { skipped.push({ rel: r, reason: 'ignored_file' }); continue }
          const st = await lstat(abs)
          if (st.size > limits.maxFileBytes) skipped.push({ rel: r, reason: 'too_large', size: st.size })
          else { files.push({ abs, rel: r, size: st.size }); bytes += st.size }
        }
      }
    }
    await visit(root, '')
    return { files, skipped }
  }

  async function importDisk(ws, { root = null } = {}) {
    if (importState.running) throw new AppError('import_running', 'An import is already running', 409)
    const w = store.needWorkspace(ws)
    const dir = root ?? w.root
    if (!dir) throw new AppError('bad_request', 'This workspace has no root folder', 400)
    let real
    try { real = await realpath(dir) } catch { throw new AppError('root_missing', 'That folder does not exist', 404) }
    if (!allowedRoots().some((r) => pathInside(real, r))) throw new AppError('forbidden_path', 'That folder is outside the allowed roots', 403)
    // other workspaces' roots nested inside this one are never imported here
    const skipRoots = new Set(store.db.prepare('SELECT root FROM workspaces WHERE id != ? AND root IS NOT NULL').all(ws).map((x) => resolve(x.root))) // incl. archived
    if (ws === 'default') skipRoots.add(resolve(real, 'workspaces')) // workspace folders live there by design (even ones this database does not know)
    Object.assign(importState, { running: true, workspace: ws, total: 0, imported: 0, skipped_existing: 0, skipped_other: 0, failed: 0, bytes: 0, started_at: Date.now(), finished_at: null, errors: [], capped: false })
    const bucket = bucketOf(ws)
    try {
      const cap = { hit: false }
      const { files, skipped } = await walk(real, skipRoots, cap)
      importState.total = files.length
      importState.skipped_other = skipped.length
      importState.capped = cap.hit
      await blobs.ensureBucket(bucket)
      let n = 0
      for (const f of files) {
        const key = FILES + f.rel
        try {
          assertBlobKey(key)
          if (await blobs.head(bucket, key)) importState.skipped_existing++ // never clobber what is already in the web
          else {
            const buf = await readFile(f.abs)
            await blobs.put(bucket, key, buf, contentTypeOf(f.rel))
            importState.imported++
            importState.bytes += buf.length
          }
        } catch (e) {
          importState.failed++
          if (importState.errors.length < MAX_ERRORS) importState.errors.push({ rel: f.rel, error: short(e) })
        }
        if (++n % 25 === 0) await sleep(2) // throttle: stay out of the way of the server
        else await new Promise((r) => setImmediate(r))
      }
    } finally {
      importState.running = false
      importState.finished_at = Date.now()
      store.emitFiles(ws, { op: 'import', count: importState.imported })
    }
    return { ...importState }
  }

  // First start: import the `default` workspace folder once (settings row), in the background.
  async function importDefaultOnce() {
    const done = store.getSetting('import.disk.default')
    if (done) return null
    const w = store.getWorkspace('default')
    if (!w?.root) return null
    try { await realpath(w.root) } catch { return null } // folder does not exist yet: try again next start
    const r = await importDisk('default')
    if (!r.failed || r.imported) store.setSetting('import.disk.default', { done_at: Date.now(), imported: r.imported, skipped_existing: r.skipped_existing, failed: r.failed })
    return r
  }

  return { importDisk, importDefaultOnce, importState, KEEP }
}
