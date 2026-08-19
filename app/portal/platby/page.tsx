/**
 * app/portal/platby/page.tsx
 *
 * Server Component — rodičovský portál, záložka Platby.
 * Zobrazuje pohledávky všech dětí přihlášeného ZZ.
 * QR kód pro každou nesplacenou pohledávku.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { payliboUrl } from '@/lib/paylibo'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type ObligationStatus = 'pending' | 'partial' | 'paid'

type StudentObligation = {
  id: string
  popis: string | null
  amount: number
  currency: string
  dueDate: string
  ssKod: string | null
  notifiedAt: string | null
  matchedTotal: number
  status: ObligationStatus
  vs: string       // variabilní symbol = číslo z kod_zaka
  qrUrl: string | null
}

type StudentWithObligations = {
  id: string
  firstName: string
  lastName: string
  kodZaka: string
  obligations: StudentObligation[]
  totalUnpaid: number
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchGuardianData(): Promise<{
  guardianName: string
  students: StudentWithObligations[]
} | null> {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Načíst ZZ
  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .single()

  if (!guardianRaw) return null
  const guardian = guardianRaw as any

  // Načíst děti přes student_guardian_links
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select(`
      students (
        id, first_name, last_name, kod_zaka
      )
    `)
    .eq('guardian_id', guardian.id)

  const students = (linksRaw as any[] ?? [])
    .map((l: any) => l.students)
    .filter(Boolean)

  if (students.length === 0) {
    return {
      guardianName: `${guardian.first_name} ${guardian.last_name}`,
      students: [],
    }
  }

  const studentIds = students.map((s: any) => s.id)

  // Načíst pohledávky pro všechny děti
  const { data: obligationsRaw } = await supabase
    .from('payment_obligations')
    .select('id, student_id, popis, amount, currency, due_date, ss_kod, notified_at')
    .in('student_id', studentIds)
    .order('due_date', { ascending: false })

  // Načíst matches
  const obligationIds = (obligationsRaw as any[] ?? []).map((o: any) => o.id)
  let matchMap: Record<string, number> = {}

  if (obligationIds.length > 0) {
    const { data: matchesRaw } = await supabase
      .from('payment_matches')
      .select('obligation_id, matched_amount')
      .in('obligation_id', obligationIds)

    ;(matchesRaw as any[] ?? []).forEach((m: any) => {
      matchMap[m.obligation_id] = (matchMap[m.obligation_id] ?? 0) + Number(m.matched_amount)
    })
  }

  // Sestavit strukturu per žák
  const result: StudentWithObligations[] = students
    .slice()
    .sort((a: any, b: any) => a.last_name.localeCompare(b.last_name, 'cs'))
    .map((s: any) => {
      const vs = s.kod_zaka?.split('-').pop() ?? ''

      const obligations: StudentObligation[] = (obligationsRaw as any[] ?? [])
        .filter((o: any) => o.student_id === s.id)
        .map((o: any) => {
          const amount       = Number(o.amount)
          const matchedTotal = matchMap[o.id] ?? 0

          let status: ObligationStatus
          if (matchedTotal <= 0)        status = 'pending'
          else if (matchedTotal < amount) status = 'partial'
          else                            status = 'paid'

          const qrUrl =
            o.ss_kod && status !== 'paid'
              ? payliboUrl({
                  amount,
                  vs,
                  ss:      o.ss_kod,
                  message: o.popis ?? '',
                })
              : null

          return {
            id:           o.id,
            popis:        o.popis,
            amount,
            currency:     o.currency ?? 'CZK',
            dueDate:      o.due_date,
            ssKod:        o.ss_kod,
            notifiedAt:   o.notified_at,
            matchedTotal,
            status,
            vs,
            qrUrl,
          }
        })

      const totalUnpaid = obligations
        .filter((o) => o.status !== 'paid')
        .reduce((sum, o) => sum + (o.amount - o.matchedTotal), 0)

      return {
        id:           s.id,
        firstName:    s.first_name,
        lastName:     s.last_name,
        kodZaka:      s.kod_zaka,
        obligations,
        totalUnpaid,
      }
    })

  return {
    guardianName: `${guardian.first_name} ${guardian.last_name}`,
    students: result,
  }
}

// ---------------------------------------------------------------------------
// UI komponenty
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ObligationStatus }) {
  const map = {
    pending: { label: 'K úhradě',        className: 'bg-amber-50 text-amber-700' },
    partial: { label: 'Částečně uhrazeno', className: 'bg-blue-50 text-blue-700' },
    paid:    { label: 'Uhrazeno',         className: 'bg-emerald-50 text-emerald-700' },
  }[status]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${map.className}`}>
      {map.label}
    </span>
  )
}

function ObligationCard({ obligation }: { obligation: StudentObligation }) {
  const isPaid     = obligation.status === 'paid'
  const remaining  = obligation.amount - obligation.matchedTotal
  const isOverdue  = !isPaid && new Date(obligation.dueDate) < new Date()

  return (
    <div className={`rounded-2xl border p-5 ${
      isPaid ? 'border-stone-100 bg-stone-50' : 'border-stone-200 bg-white'
    }`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className={`text-sm font-semibold truncate ${
            isPaid ? 'text-stone-400' : 'text-stone-900'
          }`}>
            {obligation.popis ?? 'Pohledávka'}
          </p>
          <p className={`text-xs mt-0.5 ${
            isOverdue ? 'text-red-500 font-medium' : 'text-stone-400'
          }`}>
            {isOverdue ? 'Po splatnosti · ' : 'Splatnost '}
            {new Date(obligation.dueDate).toLocaleDateString('cs-CZ', {
              day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <StatusBadge status={obligation.status} />
      </div>

      <div className="flex items-end justify-between gap-4">
        {/* Částky */}
        <div>
          {isPaid ? (
            <p className="text-lg font-bold text-emerald-600">
              {obligation.amount.toLocaleString('cs-CZ')} {obligation.currency}
            </p>
          ) : (
            <>
              <p className="text-lg font-bold text-stone-900">
                {remaining.toLocaleString('cs-CZ')} {obligation.currency}
              </p>
              {obligation.status === 'partial' && (
                <p className="text-xs text-stone-400 mt-0.5">
                  z celkových {obligation.amount.toLocaleString('cs-CZ')} {obligation.currency}
                </p>
              )}
            </>
          )}

          {/* Platební údaje pro případ nefunkčního QR */}
          {!isPaid && (
            <div className="mt-3 space-y-0.5">
              <p className="text-xs text-stone-400">
                VS: <span className="font-mono text-stone-600">{obligation.vs}</span>
              </p>
              {obligation.ssKod && (
                <p className="text-xs text-stone-400">
                  SS: <span className="font-mono text-stone-600">{obligation.ssKod}</span>
                </p>
              )}
              <p className="text-xs text-stone-400">
                Účet:{' '}
                <span className="font-mono text-stone-600">
                  {process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER}/{process.env.NEXT_PUBLIC_BANK_CODE}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* QR kód */}
        {obligation.qrUrl && (
          <div className="shrink-0 flex flex-col items-center gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={obligation.qrUrl}
              alt={`QR kód pro platbu: ${obligation.popis}`}
              className="w-32 h-32 rounded-xl"
            />
            <p className="text-xs text-stone-400">Naskenujte pro platbu</p>
          </div>
        )}

        {/* Zaplaceno — ikona */}
        {isPaid && (
          <div className="shrink-0 w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

function StudentSection({ student }: { student: StudentWithObligations }) {
  const pending = student.obligations.filter((o) => o.status !== 'paid')
  const paid    = student.obligations.filter((o) => o.status === 'paid')

  return (
    <div className="space-y-3">
      {/* Hlavička žáka */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900">
          {student.lastName} {student.firstName}
        </h2>
        {student.totalUnpaid > 0 && (
          <span className="text-sm font-semibold text-amber-600">
            K úhradě: {student.totalUnpaid.toLocaleString('cs-CZ')} Kč
          </span>
        )}
        {student.totalUnpaid === 0 && student.obligations.length > 0 && (
          <span className="text-sm text-emerald-600 font-medium">
            Vše uhrazeno ✓
          </span>
        )}
      </div>

      {student.obligations.length === 0 ? (
        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-6 text-center">
          <p className="text-sm text-stone-400">Žádné pohledávky</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Nesplacené pohledávky */}
          {pending.map((o) => (
            <ObligationCard key={o.id} obligation={o} />
          ))}

          {/* Splacené — skryté za rozbalovačkou */}
          {paid.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-stone-400 hover:text-stone-600
                transition-colors py-1 select-none list-none flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open:rotate-90"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Uhrazené pohledávky ({paid.length})
              </summary>
              <div className="mt-2 space-y-2">
                {paid.map((o) => (
                  <ObligationCard key={o.id} obligation={o} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PortalPlatbyPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isGuardian } = await supabase.rpc('is_guardian')
  if (!isGuardian) redirect('/portal')

  const data = await fetchGuardianData()
  if (!data) redirect('/login')

  const { guardianName, students } = data

  const totalUnpaid = students.reduce((sum, s) => sum + s.totalUnpaid, 0)

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-stone-900">Platby</h1>
        <p className="text-sm text-stone-500 mt-0.5">{guardianName}</p>
      </div>

      {/* Souhrnný banner */}
      {totalUnpaid > 0 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 mb-6
          flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-amber-800">Celkem k úhradě</p>
            <p className="text-2xl font-bold text-amber-700 mt-0.5">
              {totalUnpaid.toLocaleString('cs-CZ')} Kč
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      )}

      {totalUnpaid === 0 && students.length > 0 && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-4 mb-6
          flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium text-emerald-700">
            Všechny pohledávky jsou uhrazeny
          </p>
        </div>
      )}

      {/* Žáci */}
      {students.length === 0 ? (
        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-10 text-center">
          <p className="text-sm text-stone-400">Nejsou evidovány žádné děti</p>
        </div>
      ) : (
        <div className="space-y-8">
          {students.map((s) => (
            <StudentSection key={s.id} student={s} />
          ))}
        </div>
      )}

      {/* Patička s kontaktem */}
      <div className="mt-10 pt-6 border-t border-stone-100 text-center">
        <p className="text-xs text-stone-400">
          Dotazy k platbám:{' '}
          <a
            href="mailto:jana.svecova@zsvilekula.cz"
            className="text-stone-600 hover:text-stone-900 transition-colors"
          >
            jana.svecova@zsvilekula.cz
          </a>
        </p>
      </div>
    </div>
  )
}
