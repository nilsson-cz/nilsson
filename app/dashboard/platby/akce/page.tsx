/**
 * app/dashboard/platby/akce/page.tsx
 *
 * Server Component — seznam akcí (dávek) sdružených podle SS kódu.
 * Každá dávka vytvořená jedním zadáním sdílí SS kód; tady vidíme jejich
 * celkovou bilanci jako rozcestník na detail bilance akce.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type ObligationType = 'lunch' | 'event' | 'tuition' | 'druzina'

type EventGroup = {
  ssKod: string
  popis: string | null
  type: ObligationType
  dueDate: string
  studentCount: number
  totalPrescribed: number
  totalPaid: number
  totalDonations: number   // Σ dar (platby navíc u akce)
  unpaidCount: number
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchEventGroups(): Promise<EventGroup[]> {
  const supabase = await createSupabaseServerClient()

  const { data: obsRaw } = await supabase
    .from('payment_obligations')
    .select('id, type, popis, amount, due_date, ss_kod')
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .not('ss_kod', 'is', null)
    .order('due_date', { ascending: false })

  const rows = (obsRaw as any[]) ?? []
  if (rows.length === 0) return []

  // Součty párování pro všechny pohledávky
  const ids = rows.map((o: any) => o.id)
  const matchMap: Record<string, number> = {}
  const donationMap: Record<string, number> = {}
  const { data: matchesRaw } = await supabase
    .from('payment_matches')
    .select('obligation_id, matched_amount, donation_amount')
    .in('obligation_id', ids)

  ;(matchesRaw as any[] ?? []).forEach((m: any) => {
    matchMap[m.obligation_id] =
      (matchMap[m.obligation_id] ?? 0) + Number(m.matched_amount)
    donationMap[m.obligation_id] =
      (donationMap[m.obligation_id] ?? 0) + Number(m.donation_amount ?? 0)
  })

  // Seskupit podle SS kódu
  const groups = new Map<string, EventGroup>()
  for (const o of rows) {
    const ss = o.ss_kod as string
    const amount        = Number(o.amount)
    const matchedTotal  = matchMap[o.id] ?? 0
    const donationTotal = donationMap[o.id] ?? 0
    const isUnpaid      = matchedTotal < amount

    const g = groups.get(ss)
    if (!g) {
      groups.set(ss, {
        ssKod:           ss,
        popis:           o.popis,
        type:            o.type,
        dueDate:         o.due_date,
        studentCount:    1,
        totalPrescribed: amount,
        totalPaid:       matchedTotal,
        totalDonations:  donationTotal,
        unpaidCount:     isUnpaid ? 1 : 0,
      })
    } else {
      g.studentCount    += 1
      g.totalPrescribed += amount
      g.totalPaid       += matchedTotal
      g.totalDonations  += donationTotal
      g.unpaidCount     += isUnpaid ? 1 : 0
    }
  }

  // Zachovat pořadí dle due_date (mapa drží pořadí vložení = pořadí z dotazu)
  return Array.from(groups.values())
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(amount)
}

function TypeBadge({ type }: { type: ObligationType }) {
  const map: Record<string, { label: string; className: string }> = {
    lunch:   { label: 'Obědy',   className: 'bg-orange-50 text-orange-700' },
    tuition: { label: 'Školné',  className: 'bg-sky-50 text-sky-700' },
    event:   { label: 'Akce',    className: 'bg-purple-50 text-purple-700' },
    druzina: { label: 'Družina', className: 'bg-teal-50 text-teal-700' },
  }
  const m = map[type] ?? { label: type, className: 'bg-stone-100 text-stone-600' }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${m.className}`}>
      {m.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AkcePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDir && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') redirect('/dashboard')

  const groups = await fetchEventGroups()

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
          <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
            Platby
          </Link>
          <span>/</span>
          <span className="text-stone-600">Akce</span>
        </div>
        <h1 className="text-xl font-semibold text-stone-900">Akce a hromadné předpisy</h1>
        <p className="text-sm text-stone-500 mt-0.5">
          Dávky sdružené podle specifického symbolu · Školní rok {CURRENT_SCHOOL_YEAR}
        </p>
      </div>

      {/* Seznam */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-stone-400">Žádné akce ani hromadné předpisy</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {groups.map((g) => (
            <Link
              key={g.ssKod}
              href={`/dashboard/platby/akce/${encodeURIComponent(g.ssKod)}`}
              className="flex items-center gap-3 rounded-xl px-4 py-3 bg-white border border-stone-100 hover:border-stone-300 hover:bg-stone-50 transition-all group"
            >
              {/* Popis + SS */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-stone-900 truncate">
                  {g.popis ?? '—'}
                </p>
                <p className="text-xs text-stone-400 truncate mt-0.5">
                  <span className="font-mono">SS: {g.ssKod}</span>
                  {' · '}{g.studentCount} žáků
                </p>
              </div>

              {/* Typ */}
              <div className="shrink-0">
                <TypeBadge type={g.type} />
              </div>

              {/* Bilance */}
              <div className="shrink-0 text-right w-40">
                <p className="text-sm font-semibold text-stone-900">
                  {formatCurrency(g.totalPaid)}
                  <span className="text-stone-400 font-normal"> / {formatCurrency(g.totalPrescribed)}</span>
                </p>
                {g.unpaidCount > 0 ? (
                  <p className="text-xs text-amber-600">{g.unpaidCount} nedoplaceno</p>
                ) : (
                  <p className="text-xs text-emerald-600">vyrovnáno</p>
                )}
                {g.totalDonations > 0 && (
                  <p className="text-xs text-violet-600">+ dar {formatCurrency(g.totalDonations)}</p>
                )}
              </div>

              <svg
                className="w-4 h-4 text-stone-300 group-hover:text-stone-500 shrink-0 transition-colors"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
