/**
 * app/dashboard/spisovka/[id]/page.tsx
 *
 * Server Component — načte detail dokumentu a předá do DokumentDetail (Client).
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getDokumentById, getVecneSkupiny, getJmennyRejstrik } from '@/lib/essl/queries'
import DokumentDetail from '@/components/essl/DokumentDetail'

type PageProps = {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function DokumentDetailPage({ params }: PageProps) {
  const { id } = await params

  const [dokument, vecneSkupiny, jmennyRejstrik] = await Promise.all([
    getDokumentById(id),
    getVecneSkupiny(),
    getJmennyRejstrik(),
  ])

  if (!dokument) notFound()

  return (
    <div className="px-4 py-6 lg:px-8 max-w-4xl mx-auto">

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500 mb-6">
        <Link href="/dashboard/spisovka" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisovna
        </Link>
        <span>/</span>
        <span className="font-mono text-stone-600 dark:text-stone-300">{dokument.cislo_jednaci}</span>
      </nav>

      <DokumentDetail
        dokument={dokument}
        vecneSkupiny={vecneSkupiny}
        jmennyRejstrik={jmennyRejstrik}
      />
    </div>
  )
}
