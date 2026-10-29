// Tiny store-only (no compression) streaming ZIP writer. No dependencies: node:zlib gives crc32.
// Entries are streamed with a data descriptor (flag bit 3), so memory stays flat. No ZIP64: callers cap the total below 4 GiB.
import { crc32 } from 'node:zlib'

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

function dosDateTime(d) {
  const y = Math.max(1980, d.getUTCFullYear())
  const date = ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)
  return { date, time }
}

const FLAG_UTF8 = 0x0800
const FLAG_DESC = 0x0008
const MAX32 = 0xffffffff

// entries: iterable of { name, mtime?: Date, stream?: AsyncIterable<Buffer> }. A name ending in "/" is a folder (no stream).
export async function* zipStream(entries) {
  const central = []
  let offset = 0
  const emit = (buf) => { offset += buf.length; return buf }
  for await (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const { date, time } = dosDateTime(e.mtime ?? new Date())
    const isDir = e.name.endsWith('/')
    const flags = FLAG_UTF8 | (isDir ? 0 : FLAG_DESC)
    const start = offset
    yield emit(Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(0), u16(time), u16(date), u32(0), u32(0), u32(0), u16(name.length), u16(0), name]))
    let crc = 0
    let size = 0
    if (!isDir) {
      for await (const chunk of e.stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        crc = crc32(b, crc)
        size += b.length
        if (offset + b.length > MAX32 - 1_000_000) throw new Error('zip too large (ZIP64 not supported)')
        yield emit(b)
      }
      yield emit(Buffer.concat([u32(0x08074b50), u32(crc), u32(size), u32(size)]))
    }
    central.push({ name, flags, time, date, crc, size, start, isDir })
  }
  const cdStart = offset
  for (const c of central) {
    const external = c.isDir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0
    yield emit(Buffer.concat([
      u32(0x02014b50), u16((3 << 8) | 20), u16(20), u16(c.flags), u16(0), u16(c.time), u16(c.date),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(external), u32(c.start), c.name,
    ]))
  }
  const cdSize = offset - cdStart
  yield emit(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0)]))
}
