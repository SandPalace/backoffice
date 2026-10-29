'use client'
import { useEffect, useState } from 'react'
import { useBackOffice } from '@/lib/useBackOffice'
import { formatSize } from '@/lib/files'
import { ApiError, importDisk } from '@/lib/fileApi'

export default function StorageCard() {
  const { storage, storageError, refreshStorage, workspaceId } = useBackOffice()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const importing = !!storage?.import?.running
  // Poll faster while an import runs so the counter moves.
  useEffect(() => {
    if (!importing) return
    const t = setInterval(refreshStorage, 1000)
    return () => clearInterval(t)
  }, [importing, refreshStorage])

  const runImport = async () => {
    setBusy(true); setErr(null)
    try { await importDisk(workspaceId); await refreshStorage() } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message) } finally { setBusy(false) }
  }

  const im = storage?.import
  const limit = storage?.limits?.max_file_bytes
  const importForThis = im && (im.workspace === workspaceId || !im.workspace)

  const btn = 'rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-bg disabled:opacity-40'
  // Barra del encabezado de Archivos: qué es (para los agentes, en esta computadora), estado, cifras e importar.
  return (
    <section className="card flex flex-col gap-3 border-blue bg-blue-soft/60 px-4 py-3" aria-label="Archivos para los agentes y almacenamiento">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-[260px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label !text-blue">Adjuntar para los agentes</span>
          </div>
          <p className="mt-1 text-sm font-semibold">Todo lo que subas aquí lo pueden leer tus agentes con sus herramientas.</p>
        </div>

        {!storage && !storageError && <p className="text-xs text-muted" role="status">Consultando el almacenamiento…</p>}
        {!storage && storageError && <p className="text-xs text-red" role="alert">No pude consultar el almacenamiento: {storageError}. ¿Está encendido el servidor de Back Office?</p>}
        {storage && (
          <div className="flex flex-col gap-0.5">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {storage.usage && <div><dt className="text-muted">Archivos guardados</dt><dd className="font-semibold">{storage.usage.files}</dd></div>}
              {storage.usage && <div><dt className="text-muted">Espacio usado</dt><dd className="font-semibold">{storage.usage.bytes ? formatSize(storage.usage.bytes) : '0 B'}</dd></div>}
              {limit != null && <div><dt className="text-muted">Límite</dt><dd className="font-semibold">{formatSize(limit)} por archivo</dd></div>}
            </dl>
          </div>
        )}

        {storage && (
          <div className="flex flex-col items-start gap-1">
            <button className={btn} disabled={importing || busy} onClick={runImport}>
              {importing ? 'Importando…' : 'Importar carpeta del equipo'}
            </button>
          </div>
        )}
      </div>
      {importing && importForThis && <p role="status" className="text-xs font-semibold">Importando tus archivos de ~/AgentOS… {im!.imported} de {im!.total}</p>}
      {!importing && importForThis && im!.finished_at != null && (
        <p role="status" className="text-xs">
          <span className="font-semibold">{im!.imported} {im!.imported === 1 ? 'archivo importado' : 'archivos importados'}</span>
          {im!.skipped_existing > 0 && <span className="text-muted"> · {im!.skipped_existing} ya estaban</span>}
          {im!.failed > 0 && <span className="text-red"> · {im!.failed} con error</span>}
        </p>
      )}
      {err && <p role="alert" className="text-xs text-red">{err}</p>}
    </section>
  )
}
