/**
 * app/dashboard/urazy/statistika/page.tsx
 * Server Component — roční statistika úrazovosti (director-only).
 * Přepínač školního roku (?rok=), KPI, měsíční rozpad a rozpady po číselnících.
 * Agregace v lib/urazy-statistika (sdíleno s CSV exportem).
 */

import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import {
  aggregateUrazy,
  type UrazStatRow,
  type CiselnikBucket,
} from '@/lib/urazy-statistika'
import Link from 'next/link'

export const metadata = { title: 'Statistika úrazovosti — IS Nilsson' }

interface PageProps {
  searchParams: Promise<{ rok?: string }>
}

export default async function StatistikaPage({ searchParams }: PageProps) {
  const { rok } = await searchParams
  const supabase = await createServerClient()

  // Dostupné školní roky (dedup v JS — dataset je malý).
  const { data: rokyRaw } = await supabase
    .from('urazy_zaznam')
    .select('skolni_rok')
    .order('skolni_rok', { ascending: false })
  const roky = Array.from(
    new Set([CURRENT_SCHOOL_YEAR, ...((rokyRaw as { skolni_rok: string }[] | null) ?? []).map((r) => r.skolni_rok)]),
  )
  const skolniRok = rok && roky.includes(rok) ? rok : CURRENT_SCHOOL_YEAR

  const { data, error } = await supabase
    .from('urazy_zaznam')
    .select('datum_cas, je_zaznam, smrtelny, cast_tela, pricina, druh_cinnosti, misto_urazu')
    .eq('skolni_rok', skolniRok)
    .returns<UrazStatRow[]>()

  const stat = aggregateUrazy(data ?? [], skolniRok)
  const maxMesic = Math.max(1, ...stat.poMesicich.map((m) => m.count))

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link href="/dashboard/urazy" className="hover:text-gray-600 transition-colors">
          Úrazy
        </Link>
        <span aria-hidden>›</span>
        <span className="text-gray-700">Statistika</span>
      </nav>

      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Statistika úrazovosti</h1>
          <p className="text-sm text-gray-500 mt-0.5">Školní rok {skolniRok}</p>
        </div>
        <div className="flex items-center gap-3">
          {roky.length > 1 && (
            <div className="flex items-center gap-1.5">
              {roky.map((r) => (
                <Link
                  key={r}
                  href={`/dashboard/urazy/statistika?rok=${encodeURIComponent(r)}`}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    r === skolniRok ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {r}
                </Link>
              ))}
            </div>
          )}
          <a
            href={`/dashboard/urazy/statistika/csv?rok=${encodeURIComponent(skolniRok)}`}
            className="px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Stáhnout CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Chyba při načítání dat: {error.message}
        </div>
      )}

      {stat.celkem === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 py-16 text-center text-sm text-gray-400">
          Ve školním roce {skolniRok} nejsou evidovány žádné úrazy.
        </div>
      ) : (
        <div className="space-y-8">
          {/* KPI */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Úrazů celkem" value={stat.celkem} />
            <Kpi label="Se záznamem" value={stat.zaznamu} tint="violet" />
            <Kpi label="Jen kniha úrazů" value={stat.knihaOnly} />
            <Kpi label="Smrtelných" value={stat.smrtelnych} tint={stat.smrtelnych > 0 ? 'red' : undefined} />
          </div>

          {/* Měsíční rozpad */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              Po měsících
            </h2>
            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1.5">
              {stat.poMesicich.map((m) => (
                <div key={m.key} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-gray-500 font-mono text-xs">{m.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-rose-400 rounded-full"
                      style={{ width: `${(m.count / maxMesic) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-gray-700 tabular-nums">{m.count}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Číselníkové rozpady */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BreakdownCard title="Zraněná část těla" buckets={stat.castTela} celkem={stat.celkem} />
            <BreakdownCard title="Předpokládaná příčina" buckets={stat.pricina} celkem={stat.celkem} />
            <BreakdownCard title="Druh činnosti" buckets={stat.druhCinnosti} celkem={stat.celkem} />
            <BreakdownCard title="Místo úrazu" buckets={stat.mistoUrazu} celkem={stat.celkem} />
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, tint }: { label: string; value: number; tint?: 'violet' | 'red' }) {
  const valueCls =
    tint === 'red' ? 'text-red-600' : tint === 'violet' ? 'text-violet-600' : 'text-gray-900'
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className={`text-2xl font-semibold tabular-nums ${valueCls}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

function BreakdownCard({
  title,
  buckets,
  celkem,
}: {
  title: string
  buckets: CiselnikBucket[]
  celkem: number
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title}</h3>
      {buckets.length === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <ul className="space-y-1.5">
          {[...buckets]
            .sort((a, b) => b.count - a.count)
            .map((b) => (
              <li key={b.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-gray-700">{b.label}</span>
                <span className="text-gray-400 text-xs tabular-nums">
                  {Math.round((b.count / celkem) * 100)} %
                </span>
                <span className="w-6 text-right text-gray-900 tabular-nums">{b.count}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
