'use client'
import { BackOfficeContext, useBackOfficeState } from '@/lib/useBackOffice'

export default function BackOfficeProvider({ children }: { children: React.ReactNode }) {
  const state = useBackOfficeState()
  return <BackOfficeContext.Provider value={state}>{children}</BackOfficeContext.Provider>
}
