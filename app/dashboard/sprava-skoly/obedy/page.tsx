/**
 * app/dashboard/sprava-skoly/obedy/page.tsx
 * Server Component — director-only: nastavení denní SMS jídelně (modul Obědy).
 * Číslo jídelny / zapnutí / čas + testovací SMS (LunchSettingsForm) a poslední
 * záznamy odeslání (lunch_report_log) pro kontrolu. Zápis hlídá RLS is_director().
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeSchoolYear } from '@/lib/school-year'
import LunchSettingsForm from './_components/LunchSettingsForm'
import LunchPricesForm from './_components/LunchPricesForm'

export const metadata = { title: 'Obědy — nastavení SMS — IS Nilsson' }

type ReportRow = {
  report_date: string
  meal_count: number
  younger: number | null
  older: number | null
  phone: string | null
  sms_ok: boolean
  detail: string | null
  sent_at: string
}

export default async function LunchAdminPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()

  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Obědy — nastavení</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const schoolYear = computeSchoolYear(new Date())

  const [{ data: settingsRaw }, { data: logRaw }, { data: pricesRaw }] = await Promise.all([
    supabase.from('lunch_settings').select('report_phone, sms_enabled, send_hour').eq('id', 1).maybeSingle(),
    supabase.from('lunch_report_log').select('report_date, meal_count, younger, older, phone, sms_ok, detail, sent_at').order('report_date', { ascending: false }).limit(14),
    supabase.from('lunch_prices').select('age_category, unit_price').eq('school_year', schoolYear),
  ])

  const settings = (settingsRaw as { report_phone: string | null; sms_enabled: boolean; send_hour: number } | null)
    ?? { report_phone: null, sms_enabled: true, send_hour: 6 }
  const log = (logRaw as ReportRow[] | null) ?? []

  const priceRows = (pricesRaw as { age_category: string; unit_price: number }[] | null) ?? []
  const priceOf = (cat: string) => priceRows.find((p) => p.age_category === cat)?.unit_price ?? null
  const initialPrices = { '7-10': priceOf('7-10'), '11-14': priceOf('11-14') }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-sm text-gray-400 hover:text-gray-600">← Správa školy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Obědy — denní SMS jídelně</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Každý školní den ráno se na číslo jídelny odešle SMS s počtem obědů na daný den.
          Počet je uzamčen večerní uzávěrkou (22:00 předchozího dne).
        </p>
      </div>

      <LunchSettingsForm settings={settings} />

      <LunchPricesForm schoolYear={schoolYear} initial={initialPrices} />

      {/* Měsíční vyúčtování */}
      <section className="rounded-xl border border-gray-200 dark:border-stone-700 px-4 py-3.5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Měsíční vyúčtování</h2>
          <p className="text-xs text-gray-500 dark:text-stone-400">
            Přehled odebraných obědů po žácích a kategoriích, CSV export a založení pohledávek.
          </p>
        </div>
        <Link
          href="/dashboard/sprava-skoly/obedy/vyuctovani"
          className="shrink-0 rounded-lg bg-gray-900 dark:bg-stone-100 px-3 py-1.5 text-sm font-medium text-white dark:text-stone-900"
        >
          Otevřít →
        </Link>
      </section>

      {/* Poslední odeslání */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Poslední reporty</h2>
        {log.length === 0 ? (
          <p className="text-sm text-gray-400">Zatím žádné odeslané reporty.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900">
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Den</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Obědů <span className="normal-case text-gray-400">(do 11 + 11+)</span></th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Stav</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Odesláno</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {log.map((r) => (
                  <tr key={r.report_date}>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-stone-300">
                      {new Date(r.report_date).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-stone-100">
                      {r.meal_count}
                      {r.younger !== null && r.older !== null && (
                        <span className="ml-1.5 font-normal text-xs text-gray-400">({r.younger} + {r.older})</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.sms_ok ? (
                        <span className="text-green-600">✓ odesláno</span>
                      ) : (
                        <span className="text-red-600" title={r.detail ?? ''}>✕ chyba</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">
                      {new Date(r.sent_at).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
