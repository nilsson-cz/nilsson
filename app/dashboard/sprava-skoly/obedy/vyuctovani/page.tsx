/**
 * app/dashboard/sprava-skoly/obedy/vyuctovani/page.tsx
 * Ředitelské měsíční vyúčtování obědů: přehled po žácích a věkových kategoriích
 * (lunch_month_billing), součty, CSV export a ruční založení pohledávek.
 * Cron /api/cron/lunch-billing dělá totéž automaticky 1. dne za předchozí měsíc.
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import GenerateObligationsButton from './_components/GenerateObligationsButton'

export const metadata = { title: 'Obědy — měsíční vyúčtování — IS Nilsson' }
export const dynamic = 'force-dynamic'

type BillingRow = {
  student_id: string
  first_name: string
  last_name: string
  trida: string | null
  age_category: string
  meals: number
  unit_price: number | null
  amount: number | null
}

/** ?ym=YYYY-MM → {year, month}; jinak předchozí měsíc. */
function parseYm(ym: string | undefined): { year: number; month: number } {
  const m = ym?.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) }
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function ymStr(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}
function shiftYm(year: number, month: number, delta: number): string {
  const d = new Date(year, month - 1 + delta, 1)
  return ymStr(d.getFullYear(), d.getMonth() + 1)
}
function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
}
const czk = (n: number) => n.toLocaleString('cs-CZ') + ' Kč'

export default async function LunchBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>
}) {
  const sp = await searchParams
  const { year, month } = parseYm(sp.ym)
  const period = ymStr(year, month)

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()

  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Měsíční vyúčtování obědů</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const [{ data: billingRaw, error }, { data: existingRaw }] = await Promise.all([
    supabase.rpc('lunch_month_billing', { p_year: year, p_month: month }),
    supabase.from('payment_obligations').select('id').eq('type', 'lunch').eq('period', period).limit(1),
  ])

  const rows = (billingRaw as BillingRow[] | null) ?? []
  const alreadyExists = ((existingRaw as { id: string }[] | null) ?? []).length > 0

  // Součty
  const totalMeals = rows.reduce((s, r) => s + (r.meals ?? 0), 0)
  const totalAmount = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const billable = rows.filter((r) => r.amount != null && r.amount > 0)
  const missingPrice = rows.filter((r) => r.unit_price == null)
  const byCat = (cat: string) => rows.filter((r) => r.age_category === cat)
  const catSummary = (['7-10', '11-14', '15+'] as const)
    .map((cat) => ({ cat, list: byCat(cat) }))
    .filter((c) => c.list.length > 0)
    .map((c) => ({
      cat: c.cat,
      count: c.list.length,
      meals: c.list.reduce((s, r) => s + r.meals, 0),
      amount: c.list.reduce((s, r) => s + (r.amount ?? 0), 0),
    }))

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly/obedy" className="text-sm text-gray-400 hover:text-gray-600">← Obědy</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Měsíční vyúčtování obědů</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Reálně odebrané obědy (po odhláškách) × cena dle věkové kategorie.
        </p>
      </div>

      {/* Volba měsíce */}
      <div className="flex items-center gap-3">
        <Link href={`?ym=${shiftYm(year, month, -1)}`} className="rounded-lg border border-gray-300 dark:border-stone-600 px-2.5 py-1.5 text-sm">←</Link>
        <span className="text-sm font-medium text-gray-900 dark:text-stone-100 capitalize min-w-40 text-center">{monthLabel(year, month)}</span>
        <Link href={`?ym=${shiftYm(year, month, 1)}`} className="rounded-lg border border-gray-300 dark:border-stone-600 px-2.5 py-1.5 text-sm">→</Link>
        <a href={`/dashboard/sprava-skoly/obedy/vyuctovani/csv?ym=${period}`} className="ml-auto rounded-lg border border-gray-300 dark:border-stone-600 px-3 py-1.5 text-sm">Stáhnout CSV</a>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700">
          Načtení selhalo: {error.message}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Za {monthLabel(year, month)} nejsou žádné odebrané obědy.
        </div>
      ) : (
        <>
          {/* Souhrn po kategoriích */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {catSummary.map((c) => (
              <div key={c.cat} className="rounded-xl border border-gray-200 dark:border-stone-700 px-4 py-3">
                <div className="text-xs text-gray-400">{c.cat === '7-10' ? 'Mladší (do 11)' : c.cat === '11-14' ? 'Starší (11+)' : c.cat}</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-stone-100">{czk(c.amount)}</div>
                <div className="text-xs text-gray-500">{c.count} žáků · {c.meals} obědů</div>
              </div>
            ))}
            <div className="rounded-xl border border-gray-300 dark:border-stone-600 bg-gray-50 dark:bg-stone-900 px-4 py-3">
              <div className="text-xs text-gray-400">Celkem</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-stone-100">{czk(totalAmount)}</div>
              <div className="text-xs text-gray-500">{rows.length} žáků · {totalMeals} obědů</div>
            </div>
          </div>

          {missingPrice.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
              ⚠️ {missingPrice.length} žáků má kategorii bez ceny v ceníku — nebudou zahrnuti do pohledávek.
              Doplň ceny na stránce <Link href="/dashboard/sprava-skoly/obedy" className="underline">Obědy</Link>.
            </div>
          )}

          {/* Tabulka po žácích */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 dark:border-stone-800 dark:bg-stone-900 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">Žák</th>
                  <th className="px-4 py-2.5">Třída</th>
                  <th className="px-4 py-2.5">Kategorie</th>
                  <th className="px-4 py-2.5 text-right">Obědů</th>
                  <th className="px-4 py-2.5 text-right">Cena</th>
                  <th className="px-4 py-2.5 text-right">Částka</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {rows.map((r) => (
                  <tr key={r.student_id}>
                    <td className="px-4 py-2 text-gray-900 dark:text-stone-100">{r.last_name} {r.first_name}</td>
                    <td className="px-4 py-2 text-gray-500">{r.trida ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{r.age_category}</td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-stone-300">{r.meals}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{r.unit_price != null ? czk(r.unit_price) : '—'}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-stone-100">
                      {r.amount != null ? czk(r.amount) : <span className="text-amber-600">chybí cena</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Založení pohledávek */}
          <section className="rounded-xl border border-gray-200 dark:border-stone-700 px-4 py-4 space-y-2">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Pohledávky za {monthLabel(year, month)}</h2>
            <p className="text-xs text-gray-500 dark:text-stone-400">
              Založí pohledávky typu „obědy“ na žáky s cenou (SS prefix 10, splatnost 10. dne následujícího měsíce).
              Automaticky to dělá i cron 1. dne za předchozí měsíc.
            </p>
            <GenerateObligationsButton
              year={year}
              month={month}
              monthLabel={monthLabel(year, month)}
              alreadyExists={alreadyExists}
              studentCount={billable.length}
              totalAmount={totalAmount}
            />
          </section>
        </>
      )}
    </div>
  )
}
