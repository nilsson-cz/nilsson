/**
 * app/dashboard/spisovka/spisy/[id]/page.tsx
 *
 * Server Component — detail spisu + přiřazené dokumenty.
 * Přiřazení dokumentů řeší SpisDetail (Client Component).
 */

import type { ComponentProps } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSpisById, getDokumenty } from '@/lib/essl/queries'
import SpisDetail from '@/components/essl/SpisDetail'

type PageProps = {
  params: Promise<{ id: string }>
}

export const dynamic = 'force-dynamic'

export default async function SpisDetailPage({ params }: PageProps) {
  const { id } = await params

  const [spis, vsechnyDokumenty] = await Promise.all([
    getSpisById(id),
    // Načteme všechny dokumenty pro výběr při přiřazení
    getDokumenty(),
  ])

  if (!spis) notFound()

  return (
    <div className="px-4 py-6 lg:px-8 max-w-4xl mx-auto">

      {/* ── Breadcrumb ────────────────────────────────────────────────── */}
      <nav className="flex items-center gap-2 text-sm text-stone-400 dark:text-stone-500 mb-6">
        <Link href="/dashboard/spisovka" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisovna
        </Link>
        <span>/</span>
        <Link href="/dashboard/spisovka/spisy" className="hover:text-stone-600 dark:hover:text-stone-300 transition-colors">
          Spisy
        </Link>
        <span>/</span>
        <span className="font-mono text-stone-600 dark:text-stone-300">{spis.spisova_znacka}</span>
      </nav>

      <SpisDetail spis={spis as ComponentProps<typeof SpisDetail>['spis']} vsechnyDokumenty={vsechnyDokumenty} />
    </div>
  )
}
