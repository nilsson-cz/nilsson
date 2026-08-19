/**
 * app/dashboard/platby/pohledavky/[id]/page.tsx
 *
 * Server Component — detail pohledávky.
 * Zobrazuje: info o pohledávce, žák, stav platby, QR kód, historie matchů.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { payliboUrl } from '@/lib/paylibo'
import NotifyButton from './_components/NotifyButton'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type MatchRow = {
  id: string
  matchedAmount: number
  matchedAt: string
  matchedBy: string | null
  isManual: boolean
}

type ObligationDetail = {
  id: string
  type: string
  popis: string | null
  amount: number
  currency: string
  dueDate: string
  ssKod: string | null
  notifiedAt: string | null
  schoolYear: string
  student: {
    id: string
    firstName: string
    lastName: string
    kodZaka: string
  }
  matches: MatchRow[]
  matchedTotal: number
  status: 'pending' | 'partial' | 'paid'
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchObligation(id: string): Promise<ObligationDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data: raw, error } = await supabase
    .from('payment_obligations')
    .select(`
      id, type, popis, amount, currency, due_date, ss_kod, notified_at, school_year,
      students ( id, first_name, last_name, kod_zaka )
    `)
    .eq('id', id)
    .single()

  if (error || !raw) return null

  // Načíst matches
  const { data: matchesRaw } = await supabase
    .from('payment_matches')
    .select('id, matched_amount, matched_at, matched_by')
    .eq('obligation_id', id)
    .order('matched_at', { ascending: false })

  const matches: MatchRow[] = (matchesRaw as any[] ?? []).map((m: any) => ({
    id:             m.id,
    matchedAmount:  Number(m.matched_amount),
    matchedAt:      m.matched_at,
    matchedBy:      m.matched_by,
    isManual:       !!m.matched_by,
  }))

  const matchedTotal = matches.reduce((sum, m) => sum + m.matchedAmount, 0)
  const amount       = Number(raw.amount)

  let status: 'pending' | 'partial' | 'paid'
  if (matchedTotal <= 0)        status = 'pending'
  else if (matchedTotal < amount) status = 'partial'
  else                            status = 'paid'

  return {
    id:         raw.id,
    type:       raw.type,
    popis:      raw.popis,
    amount,
    currency:   raw.currency ?? 'CZK',
    dueDate:    raw.due_date,
    ssKod:      raw.ss_kod,
    notifiedAt: raw.notified_at,
    schoolYear: raw.school_year,
    student: {
      id:        raw.students.id,
      firstName: raw.students.first_name,
      lastName:  raw.students.last_name,
      kodZaka:   raw.students.kod_zaka,
    },
    matches,
    matchedTotal,
    status,
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: 'pending' | 'partial' | 'paid' }) {
  const map = {
    pending: { label: 'Nesplaceno', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    partial: { label: 'Částečně splaceno', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    paid:    { label: 'Splaceno', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  }[status]
  return (
    <span className={`text-sm font-medium px-3 py-1 rounded-full border ${map.className}`}>
      {map.label}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-stone-100 last:border-0">
      <span className="text-sm text-stone-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-stone-900 text-right">{value}</span>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5">
      <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide mb-4">
        {title}
      </h2>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PohledavkaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) redirect('/dashboard')

  const { id } = await params
  const obligation = await fetchObligation(id)
  if (!obligation) notFound()

  // VS = číslo z kod_zaka ('VIL-2025-0042' → '0042')
  const vs = obligation.student.kodZaka.split('-').pop() ?? ''

  const qrUrl = obligation.ssKod
    ? payliboUrl({
        amount:  obligation.amount,
        vs,
        ss:      obligation.ssKod,
        message: obligation.popis ?? '',
      })
    : null

  const remaining = obligation.amount - obligation.matchedTotal

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-stone-400 mb-6">
        <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
          Platby
        </Link>
        <span>/</span>
        <Link href="/dashboard/platby/pohledavky" className="hover:text-stone-600 transition-colors">
          Pohledávky
        </Link>
        <span>/</span>
        <span className="text-stone-600 truncate max-w-xs">
          {obligation.popis ?? obligation.id}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            {obligation.popis ?? 'Pohledávka'}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {obligation.student.lastName} {obligation.student.firstName}
            {' · '}
            {obligation.schoolYear}
          </p>
        </div>
        <StatusBadge status={obligation.status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Levý sloupec: info + platební údaje */}
        <div className="lg:col-span-2 space-y-4">

          {/* Detail pohledávky */}
          <Section title="Detail pohledávky">
            <div>
              <InfoRow label="Typ" value={obligation.type === 'lunch' ? 'Obědy' : 'Výjezdní akce'} />
              <InfoRow
                label="Částka"
                value={
                  <span className="text-lg font-bold text-stone-900">
                    {obligation.amount.toLocaleString('cs-CZ')} {obligation.currency}
                  </span>
                }
              />
              {obligation.status !== 'pending' && (
                <InfoRow
                  label="Uhrazeno"
                  value={
                    <span className={obligation.status === 'paid' ? 'text-emerald-600' : 'text-blue-600'}>
                      {obligation.matchedTotal.toLocaleString('cs-CZ')} {obligation.currency}
                    </span>
                  }
                />
              )}
              {obligation.status === 'partial' && (
                <InfoRow
                  label="Zbývá"
                  value={
                    <span className="text-amber-600 font-semibold">
                      {remaining.toLocaleString('cs-CZ')} {obligation.currency}
                    </span>
                  }
                />
              )}
              <InfoRow
                label="Splatnost"
                value={new Date(obligation.dueDate).toLocaleDateString('cs-CZ', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              />
              {obligation.ssKod && (
                <InfoRow
                  label="Specifický symbol"
                  value={<span className="font-mono">{obligation.ssKod}</span>}
                />
              )}
              <InfoRow
                label="Variabilní symbol"
                value={<span className="font-mono">{vs}</span>}
              />
              <InfoRow
                label="Notifikace odeslána"
                value={
                  obligation.notifiedAt
                    ? new Date(obligation.notifiedAt).toLocaleDateString('cs-CZ', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })
                    : <span className="text-stone-400">Neodeslána</span>
                }
              />
            </div>
          </Section>

          {/* Žák */}
          <Section title="Žák">
            <div>
              <InfoRow
                label="Jméno"
                value={
                  <Link
                    href={`/dashboard/zaci/${obligation.student.id}`}
                    className="text-stone-800 hover:text-stone-600 underline underline-offset-2 transition-colors"
                  >
                    {obligation.student.lastName} {obligation.student.firstName}
                  </Link>
                }
              />
              <InfoRow
                label="Kód žáka"
                value={<span className="font-mono">{obligation.student.kodZaka}</span>}
              />
            </div>
          </Section>

          {/* Historie plateb */}
          <Section title="Historie plateb">
            {obligation.matches.length === 0 ? (
              <div className="flex items-center gap-2.5 py-3">
                <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-sm text-stone-400">Zatím žádné platby</p>
              </div>
            ) : (
              <div className="space-y-2">
                {obligation.matches.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-stone-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {m.matchedAmount.toLocaleString('cs-CZ')} {obligation.currency}
                      </p>
                      <p className="text-xs text-stone-400">
                        {new Date(m.matchedAt).toLocaleDateString('cs-CZ', {
                          day: 'numeric', month: 'long', year: 'numeric',
                        })}
                        {m.isManual && (
                          <span className="ml-2 text-purple-500">ruční párování</span>
                        )}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ))}
              </div>
            )}
          </Section>

        </div>

        {/* Pravý sloupec: QR + notifikace */}
        <div className="space-y-4">

          {/* QR kód */}
          {qrUrl && obligation.status !== 'paid' && (
            <Section title="QR platba">
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
                  alt="QR kód pro platbu"
                  className="w-48 h-48 rounded-xl"
                />
                <div className="text-center">
                  <p className="text-xs text-stone-400">
                    Účet: {process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER}/{process.env.NEXT_PUBLIC_BANK_CODE}
                  </p>
                  <p className="text-xs text-stone-400 mt-0.5">
                    VS: {vs} · SS: {obligation.ssKod}
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* Notifikace */}
          <Section title="Notifikace">
            <div className="space-y-3">
              {obligation.notifiedAt ? (
                <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                  <p className="text-xs text-emerald-700 font-medium">Notifikace odeslána</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {new Date(obligation.notifiedAt).toLocaleDateString('cs-CZ', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 px-3 py-2.5">
                  <p className="text-xs text-amber-700">Email rodičům ještě nebyl odeslán</p>
                </div>
              )}
              <NotifyButton
                obligationId={obligation.id}
                alreadyNotified={!!obligation.notifiedAt}
              />
            </div>
          </Section>

        </div>
      </div>
    </div>
  )
}
