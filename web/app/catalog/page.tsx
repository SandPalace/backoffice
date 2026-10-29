'use client'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { CATALOG } from '@/lib/office/catalog'

const CatalogScene = dynamic(() => import('@/components/CatalogScene'), { ssr: false })

export default function CatalogPage() {
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="label">Back Office</div>
          <h1 className="text-2xl font-extrabold tracking-tight">Catálogo de assets 3D</h1>
        </div>
        <Link href="/" className="rounded-full border border-line bg-surface px-4 py-1.5 text-xs font-semibold hover:bg-bg">Volver a la oficina</Link>
      </header>
      <p className="max-w-[70ch] text-sm text-muted">
        Las piezas con las que se arma la oficina, extraídas de <code className="font-mono text-xs">Office.glb</code> y ordenadas. La flecha azul marca el frente de cada pieza.
        {' '}{CATALOG.length} piezas.
      </p>
      <div className="card overflow-hidden"><div className="h-[640px]"><CatalogScene /></div></div>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="label"><th className="py-2 pr-4">#</th><th className="pr-4">Pieza</th><th className="pr-4">Categoría</th><th className="pr-4">Id</th><th>Medidas (ancho × alto × fondo)</th></tr>
          </thead>
          <tbody>
            {CATALOG.map((a, i) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-2 pr-4 text-muted">{i + 1}</td>
                <td className="pr-4 font-semibold">{a.label}</td>
                <td className="pr-4 text-muted">{a.category}</td>
                <td className="pr-4 font-mono text-xs">{a.id}</td>
                <td className="font-mono text-xs text-muted">{a.size.join(' × ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
