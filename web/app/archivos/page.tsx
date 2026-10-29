'use client'
import { Suspense, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Header from '@/components/Header'
import StorageCard from '@/components/StorageCard'
import FileManager from '@/components/FileManager'
import { FILES_ROOT, normalizePrefix } from '@/lib/files'
import { useBackOffice } from '@/lib/useBackOffice'

function Manager() {
  const params = useSearchParams()
  const router = useRouter()
  const prefix = normalizePrefix(params.get('prefix'))
  const navigate = useCallback((p: string) => {
    router.push(p === FILES_ROOT ? '/archivos' : `/archivos?prefix=${encodeURIComponent(p)}`, { scroll: false })
  }, [router])
  return <FileManager prefix={prefix} navigate={navigate} />
}

export default function ArchivosPage() {
  const { conn } = useBackOffice()
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-6 sm:px-6">
      <Header conn={conn} />

      <StorageCard />

      <Suspense fallback={<section className="card p-5 text-sm text-muted" role="status">Cargando archivos…</section>}>
        <Manager />
      </Suspense>
    </main>
  )
}
