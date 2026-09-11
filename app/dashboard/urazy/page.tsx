/**
 * app/dashboard/urazy/page.tsx
 * Server Component — kniha úrazů (přehled záznamů školního roku).
 *
 * Director-only agenda (RLS urazy_zaznam_dir). Modul Úrazy = evidence žákovského
 * úrazu dle vyhl. 64/2005 Sb. ve znění 150/2025 Sb. (vzor 2026) + příprava na
 * předání ČŠI / InspIS DATA. Vzor: app/dashboard/bozp.
 */

import { CURRENT_SCHOOL_YEAR as SCHOOL_YEAR } from '@/lib/config'
import { createSupabaseServerClient as createServerClient } from '@/lib/supabase-server'
import { URAZ_STAV, formatPoradove, zranenyCeleJmeno, type UrazZaznam } from '@/lib/urazy'
import Link from 'next/link'

type Row = Pick<
  UrazZaznam,
  | 'id'
  | 'poradove_cislo'
  | 'skolni_rok'
  | 'zraneny_jmeno'
  | 'zraneny_prijmeni'
  | 'datum_cas'
  | 'je_zaznam'
  | 'smrtelny'
  | 'stav'
  | 'kniha_zapis_at'
>

const STAV_TINT: Record<string, string> = {
  rozepsany: 'bg-gray-100 text-gray-600',
  k_odeslani: 'bg-amber-100 text-amber-700',
  odeslano_csi: 'bg-green-100 text-green-700',
  aktualizovano: 'bg-blue-100 text-blue-700',
}

export const metadata = { title: 'Úrazy — IS Nilsson' }

export default async function UrazyPage() {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('urazy_zaznam')
    .select(
      'id, poradove_cislo, skolni_rok, zraneny_jmeno, zraneny_prijmeni, datum_cas, je_zaznam, smrtelny, stav, kniha_zapis_at',
    )
    .eq('skolni_rok', SCHOOL_YEAR)
    .order('poradove_cislo', { ascending: false })
    .returns<Row[]>()

  const rows = data ?? []
  const pocetZaznamu = rows.filter((r) => r.je_zaznam).length

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Úrazy</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Kniha úrazů · školní rok {SCHOOL_YEAR}
            {rows.length > 0 && (
              <>
                {' · '}
                {rows.length} {plural(rows.length, 'úraz', 'úrazy', 'úrazů')}
                {pocetZaznamu > 0 && ` (z toho ${pocetZaznamu} se záznamem)`}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/urazy/statistika"
            className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Statistika
          </Link>
          <Link
            href="/dashboard/urazy/novy"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <span aria-hidden>+</span> Nový úraz
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Chyba při načítání knihy úrazů: {error.message}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {rows.map((r) => {
            const datum = r.datum_cas
              ? new Date(r.datum_cas).toLocaleString('cs-CZ', {
                  day: 'numeric',
                  month: 'numeric',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'
            return (
              <Link
                key={r.id}
                href={`/dashboard/urazy/${r.id}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors group"
              >
                <span className="shrink-0 w-14 text-sm font-mono text-gray-400">
                  {formatPoradove(r.poradove_cislo, r.skolni_rok).split('/')[0]}.
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm flex items-center gap-2">
                    {zranenyCeleJmeno(r)}
                    {r.smrtelny && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        smrtelný
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500 truncate">{datum}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {r.je_zaznam && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
                      záznam
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      STAV_TINT[r.stav] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {URAZ_STAV[r.stav]}
                  </span>
                  <span className="text-gray-300 group-hover:text-gray-400 transition-colors">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        !error && (
          <div className="rounded-lg border border-dashed border-gray-200 py-16 text-center">
            <p className="text-gray-400 text-sm">Žádné úrazy v {SCHOOL_YEAR}</p>
            <p className="text-gray-300 text-xs mt-1">
              Klikněte na „+ Nový úraz“ pro první zápis do knihy úrazů
            </p>
          </div>
        )
      )}
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}
