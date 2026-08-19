/**
 * app/dashboard/spisovka/page.tsx
 *
 * Server Component — načte data a předá do DokumentyTable (Client).
 * Filtry jsou v searchParams (URL query string) — SSR-friendly.
 *
 * Přístup: pouze director (RLS + layout guard není potřeba, RLS to zastaví)
 */

import Link from 'next/link'
import { getDokumenty, getVecneSkupiny, getDostupneRoky } from '@/lib/essl/queries'
import DokumentyTable from '@/components/essl/DokumentyTable'
import type { DokumentyFilters } from '@/lib/essl/queries'

type PageProps = {
  searchParams: Promise<{
    rok?: string
    stav?: string
    smer?: string
    vs?: string
    q?: string
  }>
}

export const dynamic = 'force-dynamic'

export default async function SpisovkaPage({ searchParams }: PageProps) {
  const sp = await searchParams

  const filters: DokumentyFilters = {
    rok:               sp.rok  ? Number(sp.rok) : undefined,
    stav:              sp.stav || undefined,
    smer:              sp.smer || undefined,
    vecna_skupina_id:  sp.vs   || undefined,
    q:                 sp.q    || undefined,
  }

  const [dokumenty, vecneSkupiny, dostupneRoky] = await Promise.all([
    getDokumenty(filters),
    getVecneSkupiny(),
    getDostupneRoky(),
  ])

  return (
    <div className="px-4 py-6 lg:px-8 max-w-screen-xl mx-auto">

      {/* ── Hlavička ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Spisovna
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
            Elektronický systém spisové služby · {dokumenty.length} dokumentů
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/spisovka/spisy"
            className="px-3 py-2 text-sm rounded-lg border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
          >
            Spisy
          </Link>
          <Link
            href="/dashboard/spisovka/novy"
            className="px-3 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
          >
            + Nový dokument
          </Link>
        </div>
      </div>

      {/* ── Tabulka s filtry (Client Component) ───────────────────────── */}
      <DokumentyTable
        dokumenty={dokumenty}
        vecneSkupiny={vecneSkupiny}
        dostupneRoky={dostupneRoky}
        activeFilters={filters}
      />
    </div>
  )
}
