/**
 * app/dashboard/dotaznik-prehled/page.tsx
 * Server Component — ředitelský přehled vyplnění osobních dotazníků po třídách.
 *
 * Analogie /dashboard/souhlasy. Vrací JEN stav vyplnění (ne obsah odpovědí) →
 * není to zvláštní kategorie, přehled smí vidět ředitel bez čl. 9 omezení.
 * Data přes RPC get_questionnaire_overview (guard = director na DB).
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import Link from 'next/link'

export const metadata = { title: 'Osobní dotazník — přehled — IS Nilsson' }

type Row = {
  group_name: string
  student_id: string
  last_name: string
  first_name: string
  kod_zaka: string
  student_filled: boolean
  guardian_filled: boolean
}

export default async function DotaznikPrehledPage() {
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
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mb-4">Osobní dotazník — přehled</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const { data } = await supabase.rpc('get_questionnaire_overview', {
    p_school_year: CURRENT_SCHOOL_YEAR,
  })
  const rows = (data as Row[]) ?? []

  // Seskupení po třídách (zachovává pořadí z RPC)
  const groups: { name: string; rows: Row[] }[] = []
  for (const r of rows) {
    let g = groups.find((x) => x.name === r.group_name)
    if (!g) {
      g = { name: r.group_name, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }

  const totalStudents = rows.length
  const totalFilled = rows.filter((r) => r.student_filled).length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100">Osobní dotazník — přehled</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Kdo má vyplněný osobní dotazník · školní rok {CURRENT_SCHOOL_YEAR}
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white dark:bg-stone-900 dark:border-stone-800 px-4 py-3 text-sm text-gray-700 dark:text-stone-300">
        Vyplněno <span className="font-semibold">{totalFilled}</span> z{' '}
        <span className="font-semibold">{totalStudents}</span> žáků.
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádní aktivní žáci v tomto školním roce.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const filled = g.rows.filter((r) => r.student_filled).length
            return (
              <section key={g.name} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-base font-semibold text-gray-900 dark:text-stone-100">{g.name}</h2>
                  <span className="text-xs text-gray-400">
                    {filled}/{g.rows.length} vyplněno
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:bg-stone-900 dark:border-stone-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-stone-800 bg-gray-50 dark:bg-stone-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Žák</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">O dítěti</th>
                        <th className="px-3 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-gray-500">O rodině</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                      {g.rows.map((r) => (
                        <tr key={r.student_id} className="hover:bg-gray-50 dark:hover:bg-stone-800/40 transition-colors">
                          <td className="px-4 py-2.5">
                            <Link href={`/dashboard/zaci/${r.student_id}`} className="font-medium text-gray-900 dark:text-stone-100 hover:underline">
                              {r.last_name} {r.first_name}
                            </Link>
                            <span className="ml-2 text-xs text-gray-400 font-mono">{r.kod_zaka}</span>
                          </td>
                          <td className="px-3 py-2.5 text-center"><StateMark filled={r.student_filled} /></td>
                          <td className="px-3 py-2.5 text-center"><StateMark filled={r.guardian_filled} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="text-green-600">✓</span> vyplněno</span>
        <span className="inline-flex items-center gap-1.5"><span className="text-gray-300">—</span> nevyplněno</span>
        <span>Sloupec o rodině je splněný, když rodičovskou část vyplnil alespoň jeden zákonný zástupce.</span>
      </div>
    </div>
  )
}

function StateMark({ filled }: { filled: boolean }) {
  return filled ? (
    <span className="text-green-600" title="Vyplněno">✓</span>
  ) : (
    <span className="text-gray-300" title="Nevyplněno">—</span>
  )
}
