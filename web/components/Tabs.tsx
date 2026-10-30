'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useOfficeView } from '@/lib/officeViewContext'

const TABS = [
  { href: '/', label: 'Inicio' },
  { href: '/tareas', label: 'Tareas' },
  { href: '/canvas', label: 'Boards' },
  { href: '/leads', label: 'Leads' },
  { href: '/equipos', label: 'Equipos' },
  { href: '/archivos', label: 'Archivos' },
]

export default function Tabs() {
  const path = usePathname()
  // Con la vista oficina encendida el Inicio es la oficina 3D: la pestaña lo dice.
  const { officeView } = useOfficeView()
  return (
    <nav aria-label="Secciones" className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 text-xs font-semibold">
      {TABS.map((t) => {
        const on = t.href === '/' ? path === '/' : path.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={`rounded-full px-4 py-1.5 ${on ? 'bg-ink text-bg' : 'text-muted hover:text-ink'}`}>
            {t.href === '/' && officeView ? 'Oficina' : t.label}
          </Link>
        )
      })}
    </nav>
  )
}
