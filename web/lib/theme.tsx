'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
export const THEME_KEY = 'backoffice.theme'

/**
 * Rename compat (one release): browser preferences saved before the AgentOS → Back Office rename (`agentos.*` keys: theme,
 * project, office view, restored files) are copied once to their `backoffice.*` names. Same origin (localhost:4781), so
 * they are still there. Runs first, inside THEME_INIT_SCRIPT.
 */
export const LEGACY_PREFS_SCRIPT = `try{for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i);if(k&&k.indexOf('agentos.')===0){var n='backoffice.'+k.slice(8);if(localStorage.getItem(n)===null)localStorage.setItem(n,localStorage.getItem(k))}}}catch(e){}`

/** Runs in <head> before the first paint so the page never flashes the wrong theme: saved choice, else the system's. */
export const THEME_INIT_SCRIPT = `(function(){${LEGACY_PREFS_SCRIPT}try{var t=localStorage.getItem('${THEME_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()`

interface ThemeCtx { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }
const Ctx = createContext<ThemeCtx>({ theme: 'light', setTheme: () => {}, toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')
  useEffect(() => {
    setThemeState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  }, [])
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    document.documentElement.dataset.theme = t
    try { window.localStorage.setItem(THEME_KEY, t) } catch { /* private mode: it still works for this visit */ }
  }, [])
  const toggle = useCallback(() => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'), [setTheme])
  return <Ctx.Provider value={{ theme, setTheme, toggle }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
