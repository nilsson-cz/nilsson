/**
 * app/dashboard/zapis/page.tsx
 * Server Component — director-only seznam žádostí o zápis/přestup.
 *
 * Guard: jen director (RLS na enrollment_applications navíc povoluje
 * i guide/assistant/vp číst — gate tady je záměrně přísnější, viz
 * rozhodnutí v konverzaci: tenhle modul je jen pro ředitele).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  getEnrollmentApplications,
  getEnrollmentSettings,
  aktualniRokZapisu,
  type EnrollmentListFilters,
} from '@/lib/enrollment/dashboard-queries'
import { STAV_LABELS, STAV_VARIANT, type EnrollmentStav, type EnrollmentTyp } from '@/lib/enrollment/types'
import EnrollmentWindowPanel from './_components/EnrollmentWindowPanel'

export const metadata = { title: 'Zápis/Přestup — IS Nilsson' }
export const dynamic = 'force-dynamic'

const STAV_FILTER_OPTIONS: (EnrollmentStav | 'all')[] = [
  'all',
  'k_rozhodnuti',
  'dotaznik_rozpracovany',
  'dotaznik_odeslan',
  'ceka_na_spoluzastupce',
  'zalozena',
  'prijat',
  'nepryjat',
  'odklad',
  'prestup_zamitnut',
  'nedostavili_se',
  'stornovano_rodicem',
  'autoremedura_zmeneno',
]

function StavPill({ stav }: { stav: EnrollmentStav }) {
  return (
    <span className={`portal-pill portal-pill-${STAV_VARIANT[stav]}`}>
      {STAV_LABELS[stav]}
    </span>
  )
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

type PageProps = {
  searchParams: Promise<{ stav?: string; typ?: string; rok?: string }>
}

export default async function ZapisDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Zápis / Přestup</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const rokAktualni = aktualniRokZapisu()

  const stavFilter = (sp.stav as EnrollmentStav | 'all' | undefined) ?? 'all'
  const typFilter = (sp.typ as EnrollmentTyp | 'all' | undefined) ?? 'all'
  const rokFilter: number | 'all' = sp.rok === 'all' ? 'all' : sp.rok ? Number(sp.rok) : rokAktualni

  const filters: EnrollmentListFilters = {
    stav: stavFilter,
    typ: typFilter,
    rokZapisu: rokFilter,
  }

  const rows = await getEnrollmentApplications(filters)
  const settings = await getEnrollmentSettings()

  // k_rozhodnuti nahoru, jinak podle data podání (už seřazeno v query)
  const sorted = [...rows].sort((a, b) => {
    if (a.stav === 'k_rozhodnuti' && b.stav !== 'k_rozhodnuti') return -1
    if (b.stav === 'k_rozhodnuti' && a.stav !== 'k_rozhodnuti') return 1
    return 0
  })

  const csvHref = `/dashboard/zapis/csv?rok=${rokFilter === 'all' ? rokAktualni : rokFilter}`

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Zápis / Přestup</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {rows.length} {rows.length === 1 ? 'žádost' : rows.length < 5 ? 'žádosti' : 'žádostí'}
            {rokFilter !== 'all' && <> · rok zápisu {rokFilter}</>}
          </p>
        </div>
        <a
          href={csvHref}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Export CSV
        </a>
      </div>

      <EnrollmentWindowPanel
        initialOtevren={settings.zapis_otevren}
        initialOknoOd={settings.okno_od}
        initialOknoDo={settings.okno_do}
      />

      {/* Filtry */}
      <div className="flex flex-wrap gap-3 text-sm">
        <FilterLinks
          stavFilter={stavFilter}
          typFilter={typFilter}
          rokFilter={rokFilter}
          rokAktualni={rokAktualni}
        />
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádné žádosti neodpovídají zvolenému filtru.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 text-left">Dítě</th>
                <th className="px-4 py-3 text-left">Nar.</th>
                <th className="px-4 py-3 text-left">Typ</th>
                <th className="px-4 py-3 text-left">Stav</th>
                <th className="px-4 py-3 text-left">Podáno</th>
                <th className="px-4 py-3 text-left">Vlastník</th>
                <th className="px-4 py-3 text-left">eSSL spis</th>
                <th className="px-4 py-3 text-left"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((r) => (
                <tr key={r.id} className={r.stav === 'k_rozhodnuti' ? 'bg-blue-50/40' : undefined}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {r.dite_jmeno} {r.dite_prijmeni}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.datum_narozeni)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.typ === 'zapis' ? 'Zápis' : 'Přestup'}</td>
                  <td className="px-4 py-3">
                    <StavPill stav={r.stav} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.vlastnik_jmeno ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.spis_id ? (
                      <Link
                        href={`/dashboard/spisovka/spisy/${r.spis_id}`}
                        className="text-orange-600 hover:underline"
                      >
                        Spis
                      </Link>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/zapis/${r.id}`}
                      className="text-orange-600 hover:underline font-medium"
                    >
                      Otevřít →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Klikatelné filtry jako odkazy — žádný client JS potřeba (server-rendered).
function FilterLinks({
  stavFilter,
  typFilter,
  rokFilter,
  rokAktualni,
}: {
  stavFilter: string
  typFilter: string
  rokFilter: number | 'all'
  rokAktualni: number
}) {
  function href(overrides: Partial<{ stav: string; typ: string; rok: string }>) {
    const params = new URLSearchParams({
      stav: overrides.stav ?? stavFilter,
      typ: overrides.typ ?? typFilter,
      rok: overrides.rok ?? String(rokFilter),
    })
    return `/dashboard/zapis?${params.toString()}`
  }

  const roky = [rokAktualni - 1, rokAktualni, rokAktualni + 1]
  const typy: { value: string; label: string }[] = [
    { value: 'all', label: 'Všechny typy' },
    { value: 'zapis', label: 'Zápis' },
    { value: 'prestup', label: 'Přestup' },
  ]

  return (
    <>
      <div className="flex gap-1">
        {typy.map((t) => (
          <Link
            key={t.value}
            href={href({ typ: t.value })}
            className={`rounded-lg px-3 py-1.5 border transition-colors ${
              typFilter === t.value
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {STAV_FILTER_OPTIONS.map((s) => (
          <Link
            key={s}
            href={href({ stav: s })}
            className={`rounded-lg px-3 py-1.5 border transition-colors ${
              stavFilter === s
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'Všechny stavy' : STAV_LABELS[s]}
          </Link>
        ))}
      </div>
      <div className="flex gap-1">
        <Link
          href={href({ rok: 'all' })}
          className={`rounded-lg px-3 py-1.5 border transition-colors ${
            rokFilter === 'all'
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Celá historie
        </Link>
        {roky.map((r) => (
          <Link
            key={r}
            href={href({ rok: String(r) })}
            className={`rounded-lg px-3 py-1.5 border transition-colors ${
              rokFilter === r
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {r}
          </Link>
        ))}
      </div>
    </>
  )
}
