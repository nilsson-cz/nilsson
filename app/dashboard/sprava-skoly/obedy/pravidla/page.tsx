/**
 * app/dashboard/sprava-skoly/obedy/pravidla/page.tsx
 * Server Component — director-only: pravidla obědů, která přebijí objednávku
 * rodiče (migrace 142). Třída × den v týdnu („Beta v úterý nechodí") a termíny
 * od–do (týdenní expedice). Pravidla se vyhodnocují při čtení v
 * lunch_effective_orders → SMS jídelně, denní přehled i vyúčtování; objednávky
 * rodičů se nepřepisují. Zápis jen přes RPC (účinné od prvního otevřeného dne).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeSchoolYear } from '@/lib/school-year'
import LunchBlocksBoard, { type DateBlock, type GroupOption } from './_components/LunchBlocksBoard'

export const metadata = { title: 'Obědy — pravidla — IS Nilsson' }
export const dynamic = 'force-dynamic'

export default async function LunchBlocksPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()

  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Obědy — pravidla</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const schoolYear = computeSchoolYear(new Date())

  const [{ data: groupsRaw }, { data: minDateRaw }] = await Promise.all([
    supabase.from('groups').select('id, name').eq('school_year', schoolYear).order('name'),
    supabase.rpc('lunch_blocks_min_date'),
  ])
  const groups = (groupsRaw ?? []) as GroupOption[]
  const groupIds = groups.map((g) => g.id)
  const minDate = (minDateRaw as string | null) ?? new Date().toISOString().slice(0, 10)

  let weekdayActive: string[] = []
  let dateBlocks: DateBlock[] = []
  let loadError: string | null = null

  if (groupIds.length > 0) {
    const [weekdayRes, datesRes] = await Promise.all([
      supabase.from('lunch_group_weekday_blocks').select('group_id, isodow')
        .in('group_id', groupIds).is('valid_to', null),
      supabase.from('lunch_group_date_blocks').select('id, group_id, date_from, date_to, reason')
        .in('group_id', groupIds).order('date_from', { ascending: false }).limit(200),
    ])
    loadError = weekdayRes.error?.message ?? datesRes.error?.message ?? null
    weekdayActive = (weekdayRes.data ?? []).map((r) => `${r.group_id}:${r.isodow}`)
    dateBlocks = (datesRes.data ?? []) as DateBlock[]
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly/obedy" className="text-sm text-gray-400 hover:text-gray-600">← Obědy — nastavení</Link>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-stone-100 mt-1">Obědy — pravidla</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Dny, kdy třída na oběd nechodí (expedice). Pravidlo přebije objednávku rodiče: oběd se
          nenahlásí jídelně ani nevyúčtuje a rodič na ten den objednat nemůže. Objednávky se nemažou —
          po vypnutí pravidla začnou zase platit.
        </p>
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          Data se nepodařilo načíst: {loadError}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Pro školní rok {schoolYear} nejsou třídy.
        </div>
      ) : (
        <LunchBlocksBoard
          groups={groups}
          weekdayActive={weekdayActive}
          dateBlocks={dateBlocks}
          minDate={minDate}
        />
      )}
    </div>
  )
}
