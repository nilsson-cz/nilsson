import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import LunchEditBoard from './_components/LunchEditBoard'

// Denní přehled obědů pro personál (/dashboard/obedy).
// - Čtení (všichni zaměstnanci): kdo jde daný den na oběd, po třídách + součty.
//   Zdroj = RPC lunch_day_roster (migrace 083) = effective množina, tj. přesně
//   počet, který jde v ranní SMS jídelně.
// - Editace (ředitel/zástupce, jen v otevřeném okně): mód „upravit" rozbalí celý
//   roster třídy s přepínači → zápis přes lunch_staff_set_order (uzávěrka 22:00 D-1).

export const dynamic = 'force-dynamic'

type RosterRow = {
  student_id: string
  first_name: string
  last_name: string
  trida: string | null
}

type EditableRow = {
  student_id: string
  first_name: string
  last_name: string
  trida: string | null
  ordered: boolean
  auto_cancelled: boolean
}

const NO_CLASS = 'Bez třídy'

/** YYYY-MM-DD posunuté o `delta` dní. */
function shiftDate(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function formatCzDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/** Seskupí řádky podle třídy, zachová abecední pořadí tříd (Bez třídy nakonec). */
function groupByClass<T extends { trida: string | null }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const key = r.trida ?? NO_CLASS
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(r)
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === NO_CLASS) return 1
    if (b === NO_CLASS) return -1
    return a.localeCompare(b, 'cs')
  })
}

export default async function ObedyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ datum?: string; edit?: string }>
}) {
  const { datum: datumParam, edit: editParam } = await searchParams
  const datum = datumParam ?? new Date().toISOString().slice(0, 10)

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  const role = (staffRaw as { role: string } | null)?.role ?? null
  const canWrite = role === 'director' || role === 'vp'

  // Je pro tento den ještě otevřené objednávání (školní den & před uzávěrkou 22:00)?
  const { data: openRaw } = await supabase.rpc('lunch_ordering_open', { p_date: datum })
  const orderingOpen = openRaw === true
  const { data: schoolRaw } = await supabase.rpc('lunch_is_school_day', { p_date: datum })
  const isSchoolDay = schoolRaw === true

  const editMode = editParam === '1' && canWrite && orderingOpen
  const today = new Date().toISOString().slice(0, 10)

  // Data podle režimu.
  let readRows: RosterRow[] = []
  let editRows: EditableRow[] = []
  let loadError: string | null = null

  if (editMode) {
    const { data, error } = await supabase.rpc('lunch_day_editable', { p_date: datum })
    if (error) loadError = error.message
    else editRows = (data as EditableRow[]) ?? []
  } else {
    const { data, error } = await supabase.rpc('lunch_day_roster', { p_date: datum })
    if (error) loadError = error.message
    else readRows = (data as RosterRow[]) ?? []
  }

  const total = editMode
    ? editRows.filter((r) => r.ordered && !r.auto_cancelled).length
    : readRows.length

  const readGroups = groupByClass(readRows)
  const editGroups = groupByClass(editRows)

  const dateNavHref = (d: string) =>
    `/dashboard/obedy?datum=${d}${editMode ? '&edit=1' : ''}`

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Hlavička */}
      <div>
        <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Obědy — denní přehled</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
          Kdo jde daný den na oběd, po třídách. Počet odpovídá SMS pro jídelnu.
        </p>
      </div>

      {/* Přepínač dne */}
      <div className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-3">
        <Link
          href={dateNavHref(shiftDate(datum, -1))}
          className="rounded-lg px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          aria-label="Předchozí den"
        >
          ← Předchozí
        </Link>
        <div className="text-center">
          <div className="text-sm font-medium text-stone-900 dark:text-stone-100 capitalize">{formatCzDate(datum)}</div>
          {datum !== today && (
            <Link href={dateNavHref(today)} className="text-xs text-orange-600 dark:text-orange-400 hover:underline">
              zpět na dnešek
            </Link>
          )}
        </div>
        <Link
          href={dateNavHref(shiftDate(datum, 1))}
          className="rounded-lg px-3 py-1.5 text-sm text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          aria-label="Následující den"
        >
          Následující →
        </Link>
      </div>

      {loadError && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          Data se nepodařilo načíst: {loadError}
        </div>
      )}

      {!isSchoolDay ? (
        <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 px-4 py-8 text-center text-stone-500 dark:text-stone-400">
          V tento den se nevaří (víkend, prázdniny nebo ředitelské volno).
        </div>
      ) : (
        <>
          {/* Souhrn */}
          <div className="flex items-baseline justify-between rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50 dark:bg-orange-950/40 px-4 py-3">
            <span className="text-sm text-stone-600 dark:text-stone-300">Obědů celkem</span>
            <span className="text-2xl font-semibold text-orange-700 dark:text-orange-300">{total}</span>
          </div>

          {/* Přepínač edit módu (jen ředitel/zástupce, otevřené okno) */}
          {canWrite && orderingOpen && (
            <div className="flex justify-end">
              {editMode ? (
                <Link
                  href={`/dashboard/obedy?datum=${datum}`}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  Hotovo
                </Link>
              ) : (
                <Link
                  href={`/dashboard/obedy?datum=${datum}&edit=1`}
                  className="rounded-lg border border-stone-300 dark:border-stone-600 px-3 py-1.5 text-sm font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                >
                  Upravit obědy
                </Link>
              )}
            </div>
          )}
          {canWrite && !orderingOpen && (
            <p className="text-xs text-stone-400 dark:text-stone-500 text-right">
              Objednávání pro tento den je uzavřeno (po uzávěrce 22:00 předchozího dne) — jen náhled.
            </p>
          )}

          {editMode ? (
            <LunchEditBoard groups={editGroups} datum={datum} />
          ) : readGroups.length === 0 ? (
            <div className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 py-8 text-center text-stone-500 dark:text-stone-400">
              Na tento den nikdo nejde na oběd.
            </div>
          ) : (
            <div className="space-y-4">
              {readGroups.map(([trida, rows]) => (
                <div key={trida} className="rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 overflow-hidden">
                  <div className="flex items-center justify-between bg-stone-50 dark:bg-stone-800 px-4 py-2 border-b border-stone-200 dark:border-stone-700">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">{trida}</span>
                    <span className="text-xs text-stone-500 dark:text-stone-400">{rows.length}</span>
                  </div>
                  <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                    {rows.map((r) => (
                      <li key={r.student_id} className="px-4 py-2 text-sm text-stone-800 dark:text-stone-100">
                        {r.last_name} {r.first_name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
