/**
 * app/dashboard/souhlasy/page.tsx
 * Server Component — staff read-only přehled GDPR souhlasů.
 *
 * Matice žák × účel pro aktuální školní rok. Nesouhlas prominentně (červeně),
 * Neuděleno tlumeně. Data přes get_consent_overview (RPC guard = jen personál).
 *
 * Konvence dle dashboard/vp/page.tsx: gray paleta bez dark: variant,
 * CURRENT_SCHOOL_YEAR z lib/config, table styl + badge styl.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import { getConsentOverview, type ConsentState } from '@/lib/consents'

export const metadata = { title: 'GDPR souhlasy — IS Nilsson' }

type Column = { code: string; title: string; special_category: boolean }
type StudentRow = {
  student_id: string
  last_name: string
  first_name: string
  kod_zaka: string
  states: Record<string, ConsentState>
}

export default async function ConsentOverviewPage() {
  // Ujistíme se, že jde o personál (RPC sice guarduje, ale ať stránka nespadne).
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isStaff = !!staffRaw

  const rows = isStaff ? await getConsentOverview(CURRENT_SCHOOL_YEAR) : []

  // Sloupce (účely) v pořadí sort_order — RPC vrací seřazené.
  const columns: Column[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!seen.has(r.code)) {
      seen.add(r.code)
      columns.push({ code: r.code, title: r.title, special_category: r.special_category })
    }
  }

  // Pivot per žák (Map drží pořadí podle last_name z RPC).
  const byStudent = new Map<string, StudentRow>()
  for (const r of rows) {
    let s = byStudent.get(r.student_id)
    if (!s) {
      s = {
        student_id: r.student_id,
        last_name: r.last_name,
        first_name: r.first_name,
        kod_zaka: r.kod_zaka,
        states: {},
      }
      byStudent.set(r.student_id, s)
    }
    s.states[r.code] = r.state
  }
  const students = [...byStudent.values()]
  const deniedTotal = rows.filter((r) => r.state === 'denied').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">GDPR souhlasy</h1>
        <p className="text-sm text-gray-500 mt-0.5">Školní rok {CURRENT_SCHOOL_YEAR}</p>
      </div>

      {deniedTotal > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Pozor:</span> {deniedTotal} {pluralNesouhlas(deniedTotal)}
          {' '}— u dotčených žáků a účelů nezveřejňujte.
        </div>
      )}

      {students.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Žádní aktivní žáci pro {CURRENT_SCHOOL_YEAR}.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left align-bottom text-xs font-medium uppercase tracking-wide text-gray-500">
                    Žák
                  </th>
                  {columns.map((col) => (
                    <th key={col.code} className="px-3 py-3 text-left align-bottom">
                      <span className="inline-flex items-start gap-1 text-[11px] font-medium leading-tight text-gray-500">
                        {col.title}
                        {col.special_category && <LockGlyph />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((s) => (
                  <tr key={s.student_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {s.last_name} {s.first_name}
                      <span className="ml-2 text-xs text-gray-400">{s.kod_zaka}</span>
                    </td>
                    {columns.map((col) => (
                      <td key={col.code} className="px-3 py-3">
                        <StateCell state={s.states[col.code] ?? 'none'} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend />
        </>
      )}
    </div>
  )
}

// ── Buňka stavu ───────────────────────────────────────────────────────────────

function StateCell({ state }: { state: ConsentState }) {
  if (state === 'denied') {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        Nesouhlas
      </span>
    )
  }
  if (state === 'granted') {
    return <span className="text-green-600" title="Souhlas">✓</span>
  }
  return <span className="text-gray-300" title="Neuděleno">—</span>
}

// ── Pomocné ───────────────────────────────────────────────────────────────────

function LockGlyph() {
  return (
    <svg className="w-3 h-3 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-label="zvláštní kategorie">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">Nesouhlas</span>
        nezveřejňovat
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-green-600">✓</span> souhlas udělen
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-gray-300">—</span> neuděleno
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LockGlyph /> zvláštní kategorie údajů
      </span>
    </div>
  )
}

function pluralNesouhlas(n: number): string {
  if (n === 1) return 'aktivní nesouhlas'
  if (n >= 2 && n <= 4) return 'aktivní nesouhlasy'
  return 'aktivních nesouhlasů'
}
