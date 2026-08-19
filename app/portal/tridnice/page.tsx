import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

export const dynamic = 'force-dynamic'

// app/portal/tridnice/page.tsx
// Rodičovský náhled do třídní knihy.
// Používá RPC get_tridni_kniha_for_guardian — auth.uid() funguje spolehlivě
// přes RPC endpoint (PostgREST .from() má problém s JWT v @supabase/ssr).
// Kalendářní navigace: ?mesic=YYYY-MM (výchozí = aktuální měsíc).

const TYP_LABEL: Record<string, string> = {
  vyuka: 'Výuka',
  expedice: 'Expedice',
  projekt: 'Projekt',
  prazdniny: 'Prázdniny',
  reditelske_volno: 'Ředitelské volno',
  sportovni_kurz: 'Sportovní kurz',
  kulturni_akce: 'Kulturní akce',
}

const TYP_COLOR: Record<string, string> = {
  vyuka: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  expedice: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  projekt: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  prazdniny: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  reditelske_volno: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',
  sportovni_kurz: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  kulturni_akce: 'bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
}

function formatDateCZ(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatMonthCZ(year: number, month: number) {
  const d = new Date(year, month - 1, 1)
  return d.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
}

function prevMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

function nextMonth(year: number, month: number) {
  if (month === 12) return { year: year + 1, month: 1 }
  return { year, month: month + 1 }
}

export default async function PortalTridnicePage({
  searchParams,
}: {
  searchParams: Promise<{ mesic?: string }>
}) {
  const { mesic } = await searchParams

  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth() + 1

  if (mesic && /^\d{4}-\d{2}$/.test(mesic)) {
    const [y, m] = mesic.split('-').map(Number)
    if (y >= 2025 && y <= 2030 && m >= 1 && m <= 12) {
      year = y
      month = m
    }
  }

  const mesicStr = `${year}-${String(month).padStart(2, '0')}`
  const datumOd = `${mesicStr}-01`
  const datumDo = new Date(year, month, 0).toISOString().slice(0, 10)

  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: zaznamy, error } = await supabase
    .rpc('get_tridni_kniha_for_guardian', {
      p_school_year: CURRENT_SCHOOL_YEAR,
      p_datum_od: datumOd,
      p_datum_do: datumDo,
    })

  if (error) {
    console.error('[portal/tridnice] Chyba načítání:', error)
  }

  const records = (zaznamy ?? []) as any[]

  const prev = prevMonth(year, month)
  const next = nextMonth(year, month)
  const prevStr = `${prev.year}-${String(prev.month).padStart(2, '0')}`
  const nextStr = `${next.year}-${String(next.month).padStart(2, '0')}`

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
  const isFuture = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1)
  const isOldest = year === 2025 && month === 9

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-stone-100">
          Třídnice
        </h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          Přehled výuky a akcí třídy
        </p>
      </div>

      <div className="flex items-center justify-between mb-6 bg-white dark:bg-stone-900 rounded-xl border border-gray-200 dark:border-stone-700 px-4 py-3">
        {!isOldest ? (
          <a
            href={`/portal/tridnice?mesic=${prevStr}`}
            className="text-sm text-gray-500 dark:text-stone-400 hover:text-gray-900 dark:hover:text-stone-100 flex items-center gap-1 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
            {formatMonthCZ(prev.year, prev.month).split(' ')[0]}
          </a>
        ) : (
          <span className="text-sm text-gray-300 dark:text-stone-700 flex items-center gap-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </span>
        )}

        <span className="text-sm font-medium text-gray-900 dark:text-stone-100 capitalize">
          {formatMonthCZ(year, month)}
        </span>

        {!isCurrentMonth && !isFuture ? (
          <a
            href={`/portal/tridnice?mesic=${nextStr}`}
            className="text-sm text-gray-500 dark:text-stone-400 hover:text-gray-900 dark:hover:text-stone-100 flex items-center gap-1 transition-colors"
          >
            {formatMonthCZ(next.year, next.month).split(' ')[0]}
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </a>
        ) : (
          <span className="text-sm text-gray-300 dark:text-stone-700 flex items-center gap-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </span>
        )}
      </div>

      {records.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-stone-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
            className="w-10 h-10 mx-auto mb-3 opacity-40">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
          </svg>
          <p className="text-sm">Žádné záznamy pro {formatMonthCZ(year, month)}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((zaznam: any) => {
            const vystupy = (zaznam.svp_vystupy ?? []) as any[]

            return (
              <div
                key={zaznam.id}
                className="bg-white dark:bg-stone-900 rounded-xl border border-gray-200 dark:border-stone-700 p-4"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-stone-500 uppercase tracking-wide">
                      {formatDateCZ(zaznam.datum)}
                      {zaznam.cas_od && (
                        <span className="ml-2">
                          {zaznam.cas_od.slice(0, 5)}
                          {zaznam.cas_do && `\u2013${zaznam.cas_do.slice(0, 5)}`}
                        </span>
                      )}
                    </p>
                    <p className="font-medium text-gray-900 dark:text-stone-100 mt-0.5">
                      {zaznam.nazev}
                    </p>
                  </div>
                  <span className={`
                    shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full
                    ${TYP_COLOR[zaznam.typ_zaznamu] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-800 dark:text-stone-400'}
                  `}>
                    {TYP_LABEL[zaznam.typ_zaznamu] ?? zaznam.typ_zaznamu}
                  </span>
                </div>

                {zaznam.popis && (
                  <p className="text-sm text-gray-600 dark:text-stone-400 mb-3 leading-relaxed">
                    {zaznam.popis}
                  </p>
                )}

                {vystupy.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 dark:text-stone-500 cursor-pointer hover:text-gray-600 dark:hover:text-stone-300 select-none">
                      ŠVP výstupy ({vystupy.length})
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {vystupy.map((v: any, i: number) => (
                        <div key={i} className="text-xs pl-3 border-l-2 border-gray-100 dark:border-stone-700">
                          <span className="font-mono text-gray-400 dark:text-stone-600 mr-1.5">
                            {v.kod}
                          </span>
                          <span className="text-gray-600 dark:text-stone-400">
                            {v.vystup_text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
