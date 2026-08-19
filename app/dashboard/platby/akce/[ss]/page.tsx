/**
 * app/dashboard/platby/akce/[ss]/page.tsx
 *
 * Server Component — bilance celé akce (dávky) sdružené podle SS kódu.
 * Všechny pohledávky vytvořené jedním zadáním akce sdílejí stejný specifický
 * symbol (viz createObligations), takže SS kód identifikuje celou akci.
 *
 * Zobrazuje: souhrnnou bilanci (předpis vs. uhrazeno vč. přeplatků/nedoplatků)
 * a rozpis po jednotlivých žácích s odkazem na detail pohledávky.
 */

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type ObligationType = 'lunch' | 'event' | 'tuition' | 'druzina'
type LineStatus     = 'pending' | 'partial' | 'paid' | 'overpaid'

type StudentLine = {
  obligationId: string
  studentName: string
  kodZaka: string
  vs: string
  amount: number
  matchedTotal: number
  status: LineStatus
}

type EventBalance = {
  ssKod: string
  popis: string | null
  type: ObligationType
  dueDate: string
  schoolYear: string
  lines: StudentLine[]
  totalPrescribed: number
  totalPaid: number
  balance: number          // totalPaid - totalPrescribed (kladné = přeplatek, záporné = nedoplatek)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveLineStatus(amount: number, matchedTotal: number): LineStatus {
  if (matchedTotal <= 0)      return 'pending'
  if (matchedTotal < amount)  return 'partial'
  if (matchedTotal > amount)  return 'overpaid'
  return 'paid'
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('cs-CZ')
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchEventBalance(ss: string): Promise<EventBalance | null> {
  const supabase = await createSupabaseServerClient()

  // SS kód je globálně jedinečný na dávku (prefix + rrrrmm + pořadí),
  // takže filtrujeme jen podle něj.
  const { data: obsRaw } = await supabase
    .from('payment_obligations')
    .select(`
      id, type, popis, amount, due_date, ss_kod, school_year,
      students ( id, first_name, last_name, kod_zaka )
    `)
    .eq('ss_kod', ss)
    .order('created_at', { ascending: true })

  const rows = (obsRaw as any[]) ?? []
  if (rows.length === 0) return null

  // Součty párování pro pohledávky akce
  const ids = rows.map((o: any) => o.id)
  const matchMap: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: matchesRaw } = await supabase
      .from('payment_matches')
      .select('obligation_id, matched_amount')
      .in('obligation_id', ids)

    ;(matchesRaw as any[] ?? []).forEach((m: any) => {
      matchMap[m.obligation_id] =
        (matchMap[m.obligation_id] ?? 0) + Number(m.matched_amount)
    })
  }

  const lines: StudentLine[] = rows.map((o: any) => {
    const amount       = Number(o.amount)
    const matchedTotal = matchMap[o.id] ?? 0
    return {
      obligationId: o.id,
      studentName:  o.students
        ? `${o.students.last_name} ${o.students.first_name}`
        : '—',
      kodZaka:      o.students?.kod_zaka ?? '',
      vs:           o.students?.kod_zaka?.split('-').pop() ?? '',
      amount,
      matchedTotal,
      status:       deriveLineStatus(amount, matchedTotal),
    }
  })

  // Seřadit: nedoplatky nahoru, pak částečné, splacené, přeplatky
  const order: Record<LineStatus, number> = { pending: 0, partial: 1, paid: 2, overpaid: 3 }
  lines.sort((a, b) =>
    order[a.status] - order[b.status] || a.studentName.localeCompare(b.studentName, 'cs'),
  )

  const first = rows[0]
  const totalPrescribed = lines.reduce((s, l) => s + l.amount, 0)
  const totalPaid       = lines.reduce((s, l) => s + l.matchedTotal, 0)

  return {
    ssKod:           ss,
    popis:           first.popis,
    type:            first.type,
    dueDate:         first.due_date,
    schoolYear:      first.school_year,
    lines,
    totalPrescribed,
    totalPaid,
    balance:         totalPaid - totalPrescribed,
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function TypeBadge({ type }: { type: ObligationType }) {
  const map: Record<string, { label: string; className: string }> = {
    lunch:   { label: 'Obědy',   className: 'bg-orange-50 text-orange-700 border-orange-200' },
    tuition: { label: 'Školné',  className: 'bg-sky-50 text-sky-700 border-sky-200' },
    event:   { label: 'Akce',    className: 'bg-purple-50 text-purple-700 border-purple-200' },
    druzina: { label: 'Družina', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  }
  const m = map[type] ?? { label: type, className: 'bg-stone-100 text-stone-600 border-stone-200' }
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${m.className}`}>
      {m.label}
    </span>
  )
}

function LineStatusBadge({ status }: { status: LineStatus }) {
  const map = {
    pending:  { label: 'Nesplaceno', className: 'bg-amber-50 text-amber-700' },
    partial:  { label: 'Částečně',   className: 'bg-blue-50 text-blue-700' },
    paid:     { label: 'Splaceno',   className: 'bg-emerald-50 text-emerald-700' },
    overpaid: { label: 'Přeplatek',  className: 'bg-violet-50 text-violet-700' },
  }[status]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${map.className}`}>
      {map.label}
    </span>
  )
}

function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'warning' | 'info'
}) {
  const toneClass = {
    neutral:  'text-stone-900',
    positive: 'text-emerald-600',
    warning:  'text-amber-600',
    info:     'text-violet-600',
  }[tone]
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4">
      <p className="text-xs text-stone-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AkceBilancePage({
  params,
}: {
  params: Promise<{ ss: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDir && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') redirect('/dashboard')

  const { ss } = await params
  const event = await fetchEventBalance(decodeURIComponent(ss))
  if (!event) notFound()

  const paidCount     = event.lines.filter((l) => l.status === 'paid').length
  const unpaidCount   = event.lines.filter((l) => l.status === 'pending' || l.status === 'partial').length
  const overpaidCount = event.lines.filter((l) => l.status === 'overpaid').length

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto space-y-4">

      {/* Breadcrumb + header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
          <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
            Platby
          </Link>
          <span>/</span>
          <Link href="/dashboard/platby/akce" className="hover:text-stone-600 transition-colors">
            Akce
          </Link>
          <span>/</span>
          <span className="text-stone-600 font-mono text-xs">{event.ssKod}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-stone-900">
            {event.popis ?? 'Akce'}
          </h1>
          <TypeBadge type={event.type} />
        </div>
        <p className="text-sm text-stone-500 mt-0.5">
          SS: <span className="font-mono">{event.ssKod}</span>
          {' · '}Splatnost {formatDate(event.dueDate)}
          {' · '}{event.schoolYear}
        </p>
      </div>

      {/* Souhrnná bilance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Předepsáno" value={formatCurrency(event.totalPrescribed)} />
        <StatTile label="Uhrazeno" value={formatCurrency(event.totalPaid)} tone="positive" />
        <StatTile
          label={event.balance >= 0 ? 'Přeplatek celkem' : 'Nedoplatek celkem'}
          value={formatCurrency(Math.abs(event.balance))}
          tone={event.balance > 0 ? 'info' : event.balance < 0 ? 'warning' : 'neutral'}
        />
        <StatTile label="Žáků v akci" value={String(event.lines.length)} />
      </div>

      {/* Rozpad stavů */}
      <div className="flex items-center gap-3 text-xs px-1">
        {unpaidCount > 0 && (
          <span className="text-amber-600">{unpaidCount} nedoplaceno</span>
        )}
        {paidCount > 0 && (
          <span className="text-emerald-600">{paidCount} splaceno</span>
        )}
        {overpaidCount > 0 && (
          <span className="text-violet-600">{overpaidCount} přeplatek</span>
        )}
      </div>

      {/* Rozpis po žácích */}
      <div className="bg-white rounded-2xl border border-stone-200 p-2 sm:p-3">
        <div className="space-y-1">
          {event.lines.map((l) => {
            const diff = l.matchedTotal - l.amount
            return (
              <Link
                key={l.obligationId}
                href={`/dashboard/platby/pohledavky/${l.obligationId}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-stone-50 transition-colors group"
              >
                {/* Žák */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-900 truncate">
                    {l.studentName}
                  </p>
                  <p className="text-xs text-stone-400 truncate mt-0.5 font-mono">
                    VS: {l.vs || '—'}
                  </p>
                </div>

                {/* Stav */}
                <div className="shrink-0">
                  <LineStatusBadge status={l.status} />
                </div>

                {/* Částky */}
                <div className="shrink-0 text-right w-32">
                  <p className="text-sm font-semibold text-stone-900">
                    {formatCurrency(l.matchedTotal)}
                    <span className="text-stone-400 font-normal"> / {formatCurrency(l.amount)}</span>
                  </p>
                  {l.status === 'partial' && (
                    <p className="text-xs text-amber-600">zbývá {formatCurrency(-diff)}</p>
                  )}
                  {l.status === 'overpaid' && (
                    <p className="text-xs text-violet-600">+{formatCurrency(diff)}</p>
                  )}
                </div>

                <svg
                  className="w-4 h-4 text-stone-300 group-hover:text-stone-500 shrink-0 transition-colors"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )
          })}
        </div>
      </div>

    </div>
  )
}
