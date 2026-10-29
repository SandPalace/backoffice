// Copia los entregables por ruta de disco (archivo o carpeta) al almacenamiento interno del workspace. Nunca hace fallar una entrega.
import { existsSync, statSync } from 'node:fs'
import { readdir, readFile, lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { bucketOf } from './store.mjs'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_FILES = 500
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist'])

const TYPES = {
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8', '.yml': 'text/yaml; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
}
export const contentTypeOf = (name) => TYPES[extname(String(name)).toLowerCase()] ?? 'application/octet-stream'

const safeBase = (p) => {
  const b = basename(p)
  return !b || b === '.' || b === '..' ? 'file' : b
}

// Recorre una carpeta. Omite node_modules/.git/.next/dist y enlaces simbólicos; respeta los topes y deja constancia.
export async function walkFolder(root) {
  const files = []
  const skipped = []
  let capped = false
  async function visit(dir, rel) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      skipped.push({ rel: rel || '.', reason: 'unreadable' })
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      if (capped) return
      const r = rel ? `${rel}/${e.name}` : e.name
      const abs = join(dir, e.name)
      if (e.isSymbolicLink()) skipped.push({ rel: r, reason: 'symlink' })
      else if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) skipped.push({ rel: r + '/', reason: 'ignored_dir' })
        else await visit(abs, r)
      } else if (e.isFile()) {
        const st = await lstat(abs)
        if (st.size > MAX_FILE_BYTES) skipped.push({ rel: r, reason: 'too_large', size: st.size })
        else if (files.length >= MAX_FILES) {
          skipped.push({ rel: '(remaining files)', reason: `file_limit_${MAX_FILES}` })
          capped = true
        } else files.push({ abs, rel: r, size: st.size })
      }
    }
  }
  await visit(root, '')
  return { files, skipped }
}

const short = (e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200)

// `allowPath(path)`: sólo se copian al almacenamiento rutas dentro de las raíces permitidas (workspaces / ~/AgentOS).
export function createUploader({ store, blobs, allowPath = () => true }) {
  const state = { last_error: null }

  async function putFile(client, bucket, key, abs) {
    const body = await readFile(abs)
    const content_type = contentTypeOf(abs)
    const r = await client.put(bucket, key, body, content_type)
    return { size: body.length, sha256: r.sha256, content_type }
  }

  // Copia un entregable al almacenamiento. Devuelve el entregable actualizado (o tal cual si no hay archivo).
  async function uploadOutput(id) {
    let o = store.getOutput(id)
    if (!o || o.kind === 'link') return o
    const client = blobs
    if (!o.path || !existsSync(o.path) || !allowPath(o.path)) return o
    const bucket = bucketOf(o.workspace_id)
    try {
      await client.ensureBucket(bucket)
      const isDir = statSync(o.path).isDirectory()
      const name = safeBase(o.path)
      if (!isDir) {
        let key = `outputs/${o.task_id}/${name}`
        if (store.keyTaken(o.task_id, o.id, key)) key = `outputs/${o.task_id}/${o.id}/${name}`
        const m = await putFile(client, bucket, key, o.path)
        return store.setOutputStorage(o.id, { bucket, storage_key: key, ...m, uploaded_at: Date.now() })
      }
      let prefix = `outputs/${o.task_id}/${name}/`
      if (store.keyTaken(o.task_id, o.id, prefix)) prefix = `outputs/${o.task_id}/${o.id}/${name}/`
      const { files, skipped } = await walkFolder(o.path)
      const done = []
      let next = 0
      const worker = async () => {
        while (next < files.length) {
          const f = files[next++]
          const key = prefix + f.rel
          try {
            const m = await putFile(client, bucket, key, f.abs)
            done.push({ rel: f.rel, key, ...m })
          } catch (e) {
            skipped.push({ rel: f.rel, reason: 'upload_failed', error: short(e) })
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker))
      done.sort((a, b) => (a.rel < b.rel ? -1 : 1))
      const total = done.reduce((n, f) => n + f.size, 0)
      const failedAll = files.length > 0 && done.length === 0
      return store.setOutputStorage(o.id, {
        bucket, storage_key: prefix, size: total, uploaded_at: Date.now(),
        storage_error: failedAll ? 'No file could be stored' : null,
        files: { files: done, skipped },
      })
    } catch (e) {
      state.last_error = short(e)
      return store.setOutputStorage(o.id, { storage_error: short(e) })
    }
  }

  return { uploadOutput, state }
}
