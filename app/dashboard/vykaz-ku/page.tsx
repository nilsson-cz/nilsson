/**
 * app/dashboard/vykaz-ku/page.tsx
 * Server Component — „Měsíční výkaz pro KÚ" (director-only).
 *
 * Ukazuje tabulku za poslední uzavřený reportovatelný měsíc (červenec/srpen se
 * nesestavují). Přednostně načte zmrazený snapshot; pokud pro daný měsíc ještě
 * neexistuje (typicky před prvním během cronu), dopočítá hodnoty naživo jen pro
 * zobrazení. CSV souhrn všech dosavadních měsíců je ke stažení přes /csv.
 *
 * Guard: jen director (data navíc chrání RLS).
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  computeVykazMonth, lastClosedReportMonth, periodKey, monthLabel,
  VYKAZ_ROWS, displayValue, type VykazMonthValues,
} from '@/lib/vykaz-ku'

export const metadata = { title: 'Měsíční výkaz pro KÚ — IS Nilsson' }
export const dynamic = 'force-dynamic'

export default async function VykazKuPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: meRaw } = await supabase
    .from('staff').select('role').eq('user_id', user!.id).maybeSingle()
  const isDirector = (meRaw as { role?: string } | null)?.role === 'director'

  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDirector && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">Měsíční výkaz pro KÚ</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const month = lastClosedReportMonth(new Date())
  const period = periodKey(month)

  // Přednostně zmrazený snapshot; jinak živý dopočet (jen pro zobrazení).
  const { data: snapRaw } = await supabase
    .from('vykaz_ku_snapshot')
    .select('std_36, jiny_38, indiv_41, druzina_pocet, obed_pocet, captured_at')
    .eq('period', period)
    .maybeSingle()

  let values: VykazMonthValues
  let source: 'snapshot' | 'live'
  let capturedAt: string | null = null

  if (snapRaw) {
    values = {
      std_36: snapRaw.std_36,
      jiny_38: snapRaw.jiny_38,
      indiv_41: snapRaw.indiv_41,
      druzina_pocet: snapRaw.druzina_pocet,
      obed_pocet: snapRaw.obed_pocet,
    }
    source = 'snapshot'
    capturedAt = snapRaw.captured_at
  } else {
    values = await computeVykazMonth(supabase, month)
    source = 'live'
  }

  // Počet dosavadních zmrazených měsíců (řídí dostupnost CSV).
  const { count: snapCount } = await supabase
    .from('vykaz_ku_snapshot')
    .select('*', { count: 'exact', head: true })
  const hasCsv = (snapCount ?? 0) > 0

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Měsíční výkaz pro KÚ</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Poslední uzavřený měsíc: <span className="font-medium text-gray-700 dark:text-stone-200">{monthLabel(month)}</span>
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <tbody>
            {VYKAZ_ROWS.map((r, i) => (
              <tr
                key={r.key}
                className={i % 2 ? 'bg-gray-50/60 dark:bg-stone-900/40' : 'bg-white dark:bg-stone-900'}
              >
                <td className="px-4 py-3 text-gray-700 dark:text-stone-300">{r.label}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900 dark:text-stone-100 w-24">
                  {displayValue(values[r.key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kontext k hodnotám */}
      <div className="space-y-1.5 text-xs text-gray-500 dark:text-stone-400">
        <p>
          {source === 'snapshot'
            ? <>Hodnoty zmrazené k&nbsp;{capturedAt ? new Date(capturedAt).toLocaleString('cs-CZ') : '—'}.</>
            : <>Náhled — hodnoty dopočítané naživo (snapshot za tento měsíc zatím nebyl zmrazen).</>}
        </p>
        <p>Družina se počítá podle reálného výkazu docházky. Obědy zatím nemají v systému reálný výkaz (proto „N/A“).</p>
        <p>Za červenec a srpen se výkaz nesestavuje.</p>
      </div>

      {/* CSV souhrn */}
      <div className="border-t border-gray-100 dark:border-stone-800 pt-5">
        {hasCsv ? (
          <a
            href="/dashboard/vykaz-ku/csv"
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m-9 6h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Stáhnout CSV — souhrn všech měsíců
          </a>
        ) : (
          <p className="text-xs text-gray-500 dark:text-stone-400">
            CSV souhrn bude ke stažení, jakmile se zmrazí první měsíc (první běh proběhne 1.&nbsp;dne příštího měsíce).
          </p>
        )}
      </div>
    </div>
  )
}
