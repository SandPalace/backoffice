'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { SERVER, apiFetch } from '@/lib/useBackOffice'
import { Logo } from './Brand'

type Phase = 'checking' | 'down' | 'unconfigured' | 'login' | 'in'
interface AuthCtx { user: string | null; enabled: boolean; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx>({ user: null, enabled: false, logout: async () => {} })
export const useAuth = () => useContext(Ctx)

const FIELD = 'rounded-sm border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-blue'

/**
 * Local sign-in for the person who owns this Back Office. The username and password live in data/.env (or env vars, or
 * data/config.json); the form only checks them. Nothing under it (office, SSE, files) loads until there is a session.
 * If the server is unreachable the pages render so they can show their own "server not found" notice.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [user, setUser] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)

  const check = useCallback(async () => {
    try {
      const r = await fetch(`${SERVER}/api/auth/status`, { credentials: 'include', cache: 'no-store' })
      const s = await r.json()
      setEnabled(!!s.enabled)
      setUser(s.user ?? null)
      setPhase(s.authenticated ? 'in' : s.configured ? 'login' : 'unconfigured')
    } catch {
      setPhase('down')
    }
  }, [])

  useEffect(() => {
    check()
    const onAuth = () => check()
    window.addEventListener('backoffice:auth', onAuth)
    return () => window.removeEventListener('backoffice:auth', onAuth)
  }, [check])

  const logout = useCallback(async () => {
    await apiFetch(`${SERVER}/api/auth/logout`, { method: 'POST' }).catch(() => {})
    await check()
  }, [check])

  if (phase === 'checking') return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Cargando…</div>
  if (phase === 'unconfigured') return <Unconfigured onRetry={check} />
  if (phase === 'login') return <LoginForm onDone={check} />
  return <Ctx.Provider value={{ user, enabled, logout }}>{children}</Ctx.Provider>
}

function Shell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="card flex w-full max-w-md flex-col gap-4 p-6" aria-label={label}>
        <Logo />
        {children}
      </section>
    </main>
  )
}

/** No credentials yet: explains where to put them. The server re-reads the file, so «Reintentar» is enough (no restart). */
function Unconfigured({ onRetry }: { onRetry: () => void }) {
  return (
    <Shell label="Configura tu acceso">
      <div>
        <h1 className="text-lg font-extrabold tracking-tight">Falta configurar tu acceso</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Para entrar a tu oficina, define tu usuario y tu contraseña en un archivo de esta computadora. Dentro de la carpeta de Back Office crea <code className="font-mono">data/.env</code> con estas dos líneas:
        </p>
      </div>
      <pre className="overflow-x-auto rounded-sm border border-line bg-bg px-3 py-2 font-mono text-xs">{`BACKOFFICE_USER=tu-usuario\nBACKOFFICE_PASSWORD=una-contraseña-larga`}</pre>
      <p className="text-xs leading-relaxed text-muted">
        En la terminal, para que nadie más lo lea: <code className="font-mono">chmod 600 data/.env</code>. También sirven las variables de entorno con esos nombres o <code className="font-mono">data/config.json</code> con <code className="font-mono">{'{"user": "…", "password": "…"}'}</code>.
      </p>
      <button onClick={onRetry} className="rounded-full bg-blue px-5 py-2 text-sm font-semibold text-white hover:opacity-90">Ya lo guardé, reintentar</button>
    </Shell>
  )
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const r = await apiFetch(`${SERVER}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user, password: pw }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.message ?? 'No se pudo iniciar sesión.')
      onDone()
    } catch (e2) {
      setErr((e2 as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell label="Iniciar sesión">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Inicia sesión</h1>
          <p className="mt-1 text-xs text-muted">Usa el usuario y la contraseña de tu archivo <code className="font-mono">data/.env</code>.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Usuario
          <input className={FIELD} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Contraseña
          <span className="relative flex">
            <input className={`${FIELD} w-full pr-10`} type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoCapitalize="none" spellCheck={false} required />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={show}
              title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted hover:text-ink"
            >
              {show ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17.9 17.9A10.4 10.4 0 0 1 12 20c-7 0-10-8-10-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.6 9.6 0 0 1 12 4c7 0 10 8 10 8a18.6 18.6 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </span>
        </label>
        {err && <div role="alert" data-testid="auth-error" className="rounded-sm border border-red bg-red-soft px-3 py-2 text-xs text-red">{err}</div>}
        <button disabled={busy} className="rounded-full bg-blue px-5 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40">
          {busy ? 'Un momento…' : 'Entrar'}
        </button>
      </form>
    </Shell>
  )
}
