// Blob store: the built-in local content store (the only storage backend).
// Layout on disk: <home>/store/<bucket>/<key>, plus .meta/ (sidecar per object) and .tmp/ (atomic writes).
// Interface (all async): put, get, head, delete, copy, list, ensureBucket, usage
//   put(bucket, key, body, contentType)  -> { etag, sha256, size }
//   get(bucket, key)                     -> { stream, size, contentType, lastModified, sha256? } | null
//   head(bucket, key)                    -> { size, contentType, lastModified, sha256? } | null
//   list(bucket, prefix, {delimiter,max})-> { objects:[{key,size,lastModified}], prefixes:[], truncated }
//   copy(bucket, srcKey, dstKey)         -> { size, sha256, contentType }
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const MAX_OBJECT_BYTES = 50 * 1024 * 1024
const sha256hex = (b) => createHash('sha256').update(b).digest('hex')
export { sha256hex }

export class BlobError extends Error {
  constructor(http, code, message) {
    super(message)
    this.http = http
    this.code = code
  }
}

const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
export const isValidBucket = (b) => typeof b === 'string' && BUCKET_RE.test(b)
const invalidKey = (msg) => new BlobError(400, 'InvalidKey', msg)

const CTRL = /[\x00-\x1f\x7f]/
const segOk = (s) => Buffer.byteLength(s) <= 240

// No absolute keys, no `..`/`.`, no backslashes, no empty segments, no NUL/control chars, <= 1024 chars.
export function assertBlobKey(key) {
  if (typeof key !== 'string' || !key || key.length > 1024) throw invalidKey('Invalid key')
  if (key.startsWith('/') || key.includes('\\') || key.split('/').some((x) => x === '..' || x === '.')) throw invalidKey('Invalid key (absolute path or ..)')
  const parts = key.split('/')
  if (key.endsWith('/') || parts.some((s) => s === '')) throw invalidKey('Invalid key (empty segment or trailing slash)')
  if (CTRL.test(key)) throw invalidKey('Invalid key (control characters)')
  if (!parts.every(segOk)) throw invalidKey('Invalid key (segment too long)')
  return key
}
// A listing prefix: '' or a (possibly partial / trailing-slash) key.
export function assertPrefix(prefix) {
  if (prefix === '' || prefix == null) return ''
  if (typeof prefix !== 'string' || prefix.length > 1024 || prefix.startsWith('/') || prefix.includes('\\') || CTRL.test(prefix) || prefix.split('/').some((s) => s === '..' || s === '.'))
    throw invalidKey('Invalid prefix')
  if (prefix.replace(/\/$/, '').split('/').some((s) => s === '')) throw invalidKey('Invalid prefix (empty segment)')
  return prefix
}

const mapFsError = (e) => {
  if (e instanceof BlobError) return e
  if (['ENOTDIR', 'EISDIR', 'EEXIST', 'ENOTEMPTY'].includes(e?.code)) return new BlobError(409, 'conflict', 'A file and a folder share that name')
  if (e?.code === 'ENAMETOOLONG') return new BlobError(400, 'InvalidKey', 'Name too long')
  return e
}

const readAllCapped = async (stream, max) => {
  const chunks = []
  let n = 0
  for await (const c of stream) {
    n += c.length
    if (n > max) {
      stream.destroy?.()
      throw new BlobError(413, 'too_large', `Object is larger than ${max} bytes`)
    }
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}
export { readAllCapped as readStream }

export function createLocalStore({ root, typeOf = () => 'application/octet-stream' }) {
  const base = resolve(root)
  const metaBase = join(base, '.meta') // sidecar per object: content type, size, sha256, mtime
  const tmpBase = join(base, '.tmp') // same filesystem as the data, so rename() is atomic
  let ready = false
  const init = () => {
    if (ready) return
    mkdirSync(tmpBase, { recursive: true })
    mkdirSync(metaBase, { recursive: true })
    ready = true
  }
  const bucketDir = (b) => {
    if (!isValidBucket(b)) throw new BlobError(400, 'InvalidBucketName', `Invalid bucket name: ${b}`)
    return join(base, b)
  }

  // Walks key segments one by one refusing symbolic links. create=true makes the parent folders.
  async function locate(bucket, key, { create = false } = {}) {
    init()
    const bdir = bucketDir(bucket)
    if (create) await mkdir(bdir, { recursive: true })
    const parts = key.split('/')
    let cur = bdir
    for (let i = 0; i < parts.length; i++) {
      cur = join(cur, parts[i])
      const last = i === parts.length - 1
      let st = null
      try { st = await lstat(cur) } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e }
      if (st?.isSymbolicLink()) throw new BlobError(403, 'symlink', 'Refusing to follow a symbolic link')
      if (!st) {
        if (!create) return { abs: join(bdir, ...parts), st: null }
        if (!last) await mkdir(cur).catch((e) => { if (e.code !== 'EEXIST') throw e })
        continue
      }
      if (last) return { abs: cur, st }
      if (!st.isDirectory()) {
        if (create) throw new BlobError(409, 'conflict', `"${parts.slice(0, i + 1).join('/')}" is a file, not a folder`)
        return { abs: join(bdir, ...parts), st: null }
      }
    }
    return { abs: cur, st: null }
  }

  const metaPath = (bucket, key) => join(metaBase, bucket, key + '.json')
  async function writeMeta(bucket, key, meta) {
    const p = metaPath(bucket, key)
    await mkdir(dirname(p), { recursive: true })
    const tmp = join(tmpBase, randomUUID())
    await writeFile(tmp, JSON.stringify(meta), { mode: 0o600 })
    await rename(tmp, p)
  }
  async function readMeta(bucket, key, st) {
    try {
      const m = JSON.parse(await readFile(metaPath(bucket, key), 'utf8'))
      return m.size === st.size && Math.abs((m.mtimeMs ?? -1) - st.mtimeMs) < 1 ? m : null // stale sidecar (file changed behind our back)
    } catch { return null }
  }
  async function prune(bdir, dir) {
    while (dir !== bdir && dir.startsWith(bdir)) {
      try { await rmdir(dir) } catch { break }
      dir = dirname(dir)
    }
  }
  const hashFile = async (abs) => {
    const h = createHash('sha256')
    for await (const c of createReadStream(abs)) h.update(c)
    return h.digest('hex')
  }
  const view = async (bucket, key, abs, st, { sha = false } = {}) => {
    const m = await readMeta(bucket, key, st)
    return {
      size: st.size,
      contentType: m?.contentType ?? typeOf(key),
      lastModified: new Date(st.mtimeMs),
      sha256: m?.sha256 ?? (sha ? await hashFile(abs) : undefined),
    }
  }

  return {
    backend: 'local',
    root: base,
    async ensureBucket(bucket) {
      init()
      await mkdir(bucketDir(bucket), { recursive: true })
      return true
    },
    async put(bucket, key, body, contentType = 'application/octet-stream') {
      assertBlobKey(key)
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
      if (buf.length > MAX_OBJECT_BYTES) throw new BlobError(413, 'too_large', 'Object is too large')
      const sha = sha256hex(buf)
      try {
        const { abs, st } = await locate(bucket, key, { create: true })
        if (st?.isDirectory()) throw new BlobError(409, 'conflict', 'A folder has that name')
        const tmp = join(tmpBase, randomUUID())
        await writeFile(tmp, buf, { mode: 0o600 })
        try { await rename(tmp, abs) } catch (e) { await rm(tmp, { force: true }); throw e }
        const nst = await stat(abs)
        await writeMeta(bucket, key, { contentType, size: buf.length, sha256: sha, mtimeMs: nst.mtimeMs })
      } catch (e) { throw mapFsError(e) }
      return { etag: sha.slice(0, 32), sha256: sha, size: buf.length }
    },
    async head(bucket, key, opts) {
      assertBlobKey(key)
      const { abs, st } = await locate(bucket, key)
      if (!st || !st.isFile()) return null
      return view(bucket, key, abs, st, opts)
    },
    async get(bucket, key) {
      assertBlobKey(key)
      const { abs, st } = await locate(bucket, key)
      if (!st || !st.isFile()) return null
      const v = await view(bucket, key, abs, st)
      return { ...v, stream: createReadStream(abs) }
    },
    async delete(bucket, key) {
      assertBlobKey(key)
      const { abs, st } = await locate(bucket, key)
      if (!st) return true
      if (!st.isFile()) throw new BlobError(409, 'conflict', 'That key is a folder')
      await unlink(abs)
      await rm(metaPath(bucket, key), { force: true })
      await prune(bucketDir(bucket), dirname(abs))
      await prune(join(metaBase, bucket), dirname(metaPath(bucket, key)))
      return true
    },
    async copy(bucket, src, dst) {
      assertBlobKey(src)
      assertBlobKey(dst)
      const from = await locate(bucket, src)
      if (!from.st?.isFile()) throw new BlobError(404, 'not_found', `No such object: ${src}`)
      try {
        const to = await locate(bucket, dst, { create: true })
        if (to.st?.isDirectory()) throw new BlobError(409, 'conflict', 'A folder has that name')
        const tmp = join(tmpBase, randomUUID())
        await copyFile(from.abs, tmp)
        await rename(tmp, to.abs)
        const nst = await stat(to.abs)
        const m = await readMeta(bucket, src, from.st)
        const sha = m?.sha256 ?? (await hashFile(to.abs))
        const contentType = m?.contentType ?? typeOf(src)
        await writeMeta(bucket, dst, { contentType, size: nst.size, sha256: sha, mtimeMs: nst.mtimeMs })
        return { size: nst.size, sha256: sha, contentType }
      } catch (e) { throw mapFsError(e) }
    },
    async list(bucket, prefix = '', { delimiter, max = 5000 } = {}) {
      assertPrefix(prefix)
      init()
      const bdir = bucketDir(bucket)
      const out = { objects: [], prefixes: [], truncated: false }
      if (!existsSync(bdir)) return out
      const idx = prefix.lastIndexOf('/')
      const dirPart = prefix.slice(0, idx + 1)
      const namePrefix = prefix.slice(idx + 1)
      // the starting folder must be reachable without symlinks
      let startAbs = bdir
      for (const seg of dirPart.split('/').filter(Boolean)) {
        startAbs = join(startAbs, seg)
        let st
        try { st = await lstat(startAbs) } catch { return out }
        if (st.isSymbolicLink() || !st.isDirectory()) return out
      }
      const walk = async (abs, keyPrefix, filter) => {
        let entries
        try { entries = await readdir(abs, { withFileTypes: true }) } catch { return }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        for (const e of entries) {
          if (out.truncated) return
          if (filter && !e.name.startsWith(filter)) continue
          if (e.isSymbolicLink()) continue
          if (e.isDirectory()) {
            if (delimiter) {
              let empty = true
              try { empty = (await readdir(join(abs, e.name))).length === 0 } catch {}
              if (!empty) out.prefixes.push(keyPrefix + e.name + '/')
            } else await walk(join(abs, e.name), keyPrefix + e.name + '/', '')
          } else if (e.isFile()) {
            if (out.objects.length >= max) { out.truncated = true; return }
            const st = await stat(join(abs, e.name)).catch(() => null)
            if (st) out.objects.push({ key: keyPrefix + e.name, size: st.size, lastModified: new Date(st.mtimeMs).toISOString(), contentType: typeOf(e.name) })
          }
        }
      }
      await walk(startAbs, dirPart, namePrefix)
      return out
    },
  }
}


// ───────────────────────── facade used by the server ─────────────────────────
export function createBlobs({ root, typeOf }) {
  const st = createLocalStore({ root, typeOf })
  const usage = async () => {
    let files = 0
    let bytes = 0
    let buckets = []
    try { buckets = (await readdir(st.root, { withFileTypes: true })).filter((e) => e.isDirectory() && isValidBucket(e.name)) } catch {}
    for (const b of buckets) {
      const r = await st.list(b.name, '', { max: 1e7 })
      for (const o of r.objects) {
        if (o.key.startsWith('trash/') || o.key.endsWith('/.keep')) continue // trash and folder markers are not "files"
        files++
        bytes += o.size
      }
    }
    return { files, bytes }
  }
  return {
    ...st,
    local: () => st,
    usage,
    put: async (bucket, key, body, ct) => ({ ...(await st.put(bucket, key, body, ct)), backend: 'local' }),
    status: async (extra = {}) => ({ backend: 'local', root: st.root, ...extra, usage: await usage().catch(() => ({ files: 0, bytes: 0 })) }),
  }
}
