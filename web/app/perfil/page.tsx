'use client'
import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/Header'
import { getJson, send, useBackOffice } from '@/lib/useBackOffice'

type Profile = { preferred_name: string; about: string; personal_goals: string; professional_goals: string; current_focus: string; work_style: string; updated_at: number | null }
type Insight = { id: number; text: string; category: string; source: string; created_at: number }
type Field = Exclude<keyof Profile, 'updated_at'>

const FIELDS: { key: Field; label: string; placeholder: string; rows?: number }[] = [
  { key: 'preferred_name', label: '¿Cómo te llamo?', placeholder: 'Tu nombre o apodo, como quieras que te diga' },
  { key: 'about', label: 'Sobre ti y tu negocio', placeholder: 'Quién eres, a qué te dedicas, cómo es tu negocio, tu equipo y tus clientes…', rows: 5 },
  { key: 'personal_goals', label: 'Objetivos personales', placeholder: 'Lo que quieres lograr en tu vida: tiempo libre, salud, familia, aprender algo…', rows: 4 },
  { key: 'professional_goals', label: 'Objetivos profesionales', placeholder: 'Lo que quieres lograr con tu trabajo o negocio: ventas, clientes, crecimiento, lanzamientos…', rows: 4 },
  { key: 'current_focus', label: 'En qué estás enfocado ahora', placeholder: 'Tus prioridades de este trimestre o de las próximas semanas', rows: 3 },
  { key: 'work_style', label: 'Cómo prefieres que te ayuden', placeholder: 'Respuestas cortas o detalladas, tono, cuándo preguntarte, qué te estorba…', rows: 3 },
]
const CATEGORIES: Record<string, string> = { preference: 'Preferencia', goal: 'Meta', context: 'Contexto', communication: 'Comunicación', other: 'Otro' }
const EMPTY: Record<Field, string> = { preferred_name: '', about: '', personal_goals: '', professional_goals: '', current_focus: '', work_style: '' }
const fmt = (t: number) => new Date(t).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

export default function PerfilPage() {
  const { conn } = useBackOffice()
  const [saved, setSaved] = useState<Record<Field, string>>(EMPTY)
  const [form, setForm] = useState<Record<Field, string>>(EMPTY)
  const [insights, setInsights] = useState<Insight[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await getJson('/api/profile')
      const next = { ...EMPTY }
      for (const f of FIELDS) next[f.key] = d.profile[f.key] ?? ''
      setSaved(next)
      setForm((cur) => (loaded ? cur : next))
      setInsights(d.insights)
      setLoaded(true)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }, [loaded])
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = FIELDS.some((f) => form[f.key] !== saved[f.key])

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const patch: Partial<Record<Field, string>> = {}
      for (const f of FIELDS) if (form[f.key] !== saved[f.key]) patch[f.key] = form[f.key]
      const d = await send('PATCH', '/api/profile', patch)
      const next = { ...EMPTY }
      for (const f of FIELDS) next[f.key] = d.profile[f.key] ?? ''
      setSaved(next)
      setForm(next)
      setMsg({ ok: true, text: 'Guardado. Assistant ya lo tiene en cuenta.' })
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function removeInsight(id: number) {
    try {
      await send('DELETE', `/api/profile/insights/${id}`)
      setInsights((l) => l.filter((i) => i.id !== id))
    } catch (e: any) {
      setMsg({ ok: false, text: e.message })
    }
  }

  const input = 'w-full rounded-[2px] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-blue focus:outline-none'

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <h1 className="text-xl font-bold">Mi perfil</h1>
      <p className="text-sm text-muted">Cuéntale a Assistant quién eres y qué quieres lograr. Ella lo consulta para adaptar sus consejos y su tono a ti. Todo se queda en tu computadora.</p>

      <form className="card flex flex-col gap-4 p-5" onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) save() }}>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1.5">
            <span className="label">{f.label}</span>
            {f.rows ? (
              <textarea className={input} rows={f.rows} maxLength={4000} value={form[f.key]} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input className={input} maxLength={120} value={form[f.key]} placeholder={f.placeholder} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
        <p className="text-xs text-muted">Por favor no escribas contraseñas, datos de pago ni información de salud.</p>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!dirty || busy} className="rounded-full bg-blue px-5 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Guardando…' : 'Guardar'}</button>
          {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-muted' : 'text-red'}`}>{msg.text}</span>}
        </div>
      </form>

      <section className="card flex flex-col gap-3 p-5" aria-labelledby="aprendido">
        <h2 id="aprendido" className="text-base font-bold">Lo que Assistant ha aprendido de ti</h2>
        {insights.length === 0 ? (
          <p className="text-sm text-muted">Todavía no ha anotado nada. Conforme platiquen, Assistant irá guardando aquí lo que aprenda de ti; puedes borrar lo que no te parezca.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {insights.map((i) => (
              <li key={i.id} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-muted">{CATEGORIES[i.category] ?? i.category}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{i.text}</p>
                  <p className="text-xs text-muted">{fmt(i.created_at)}</p>
                </div>
                <button type="button" onClick={() => removeInsight(i.id)} aria-label={`Borrar: ${i.text}`} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-muted hover:text-ink">Borrar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </main>
  )
}
