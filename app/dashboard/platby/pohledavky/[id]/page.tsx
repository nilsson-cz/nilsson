/**
 * app/dashboard/platby/pohledavky/[id]/page.tsx
 */

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { payliboUrl } from '@/lib/paylibo'
import { NotifyButton } from './_components/NotifyButton'
import { ManualMatchForm } from './_components/ManualMatchForm'
import UnmatchButton from '../../_components/UnmatchButton'

type ObligationStatus = 'pending' | 'partial' | 'paid'
type ObligationType   = 'lunch' | 'event' | 'tuition' | 'druzina'

type MatchRow = {
  transactionId: string
  matched_amount: number
  donation_amount: number
  matched_at: string
  isManual: boolean
  transaction_date: string | null
  variable_symbol: string | null
  counterparty_name: string | null
}

type ObligationDetail = {
  id: string
  type: ObligationType
  popis: string | null
  amount: number
  due_date: string
  notified_at: string | null
  ss_kod: string | null
  school_year: string
  student: { id: string; first_name: string; last_name: string; kod_zaka: string }
  matches: MatchRow[]
  matched_total: number
  status: ObligationStatus
  vs: string
}

function deriveStatus(amount: number, matchedTotal: number): ObligationStatus {
  if (matchedTotal <= 0)     return 'pending'
  if (matchedTotal < amount) return 'partial'
  return 'paid'
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('cs-CZ')
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(amount)
}

async function fetchObligation(id: string): Promise<ObligationDetail | null> {
  const supabase = await createSupabaseServerClient()

  // 1. Pohledávka
  const { data: ob, error: obErr } = await supabase
    .from('payment_obligations')
    .select('id, type, popis, amount, due_date, notified_at, ss_kod, school_year, student_id')
    .eq('id', id)
    .single()

  if (obErr || !ob) return null

  // 2. Žák
  const { data: student, error: stErr } = await supabase
    .from('students')
    .select('id, first_name, last_name, kod_zaka')
    .eq('id', ob.student_id)
    .single()

  if (stErr || !student) return null

  // 3. Párování (PK je (transaction_id, obligation_id) — žádné id ani match_type;
  //    ruční vs. auto se pozná podle matched_by).
  const { data: matchesRaw } = await supabase
    .from('payment_matches')
    .select('transaction_id, matched_amount, donation_amount, matched_at, matched_by')
    .eq('obligation_id', id)
    .order('matched_at', { ascending: false })

  // 4. Transakce k párováním (separátní dotaz)
  const txIds = (matchesRaw ?? []).map((m: any) => m.transaction_id).filter(Boolean)
  let txMap: Record<string, any> = {}

  if (txIds.length > 0) {
    const { data: txRaw } = await supabase
      .from('payment_transactions')
      .select('id, transaction_date, variable_symbol, counterparty_name')
      .in('id', txIds)

    ;(txRaw ?? []).forEach((t: any) => { txMap[t.id] = t })
  }

  const matches: MatchRow[] = (matchesRaw ?? []).map((m: any) => {
    const tx = txMap[m.transaction_id] ?? null
    return {
      transactionId:    m.transaction_id,
      matched_amount:   Number(m.matched_amount),
      donation_amount:  Number(m.donation_amount ?? 0),
      matched_at:       m.matched_at,
      isManual:         !!m.matched_by,
      transaction_date: tx?.transaction_date ?? null,
      variable_symbol:  tx?.variable_symbol ?? null,
      counterparty_name: tx?.counterparty_name ?? null,
    }
  })

  // Uhrazeno = Σ matched_amount (dar se do dluhu nepočítá).
  const matched_total = matches.reduce((sum, m) => sum + m.matched_amount, 0)
  const vs = (student as any).kod_zaka?.split('-').pop() ?? ''

  return {
    id:           ob.id,
    type:         ob.type as ObligationType,
    popis:        ob.popis,
    amount:       Number(ob.amount),
    due_date:     ob.due_date,
    notified_at:  ob.notified_at,
    ss_kod:       ob.ss_kod,
    school_year:  ob.school_year,
    student:      student as any,
    matches,
    matched_total,
    status:       deriveStatus(Number(ob.amount), matched_total),
    vs,
  }
}

function StatusBadge({ status }: { status: ObligationStatus }) {
  const map = {
    pending: { label: 'Nesplaceno', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    partial: { label: 'Částečně',   className: 'bg-blue-50 text-blue-700 border-blue-200' },
    paid:    { label: 'Splaceno',   className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  }[status]
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${map.className}`}>
      {map.label}
    </span>
  )
}

function TypeBadge({ type }: { type: ObligationType }) {
  const map = {
    lunch:   { label: 'Obědy',   className: 'bg-orange-50 text-orange-700 border-orange-200' },
    tuition: { label: 'Školné',  className: 'bg-sky-50 text-sky-700 border-sky-200' },
    event:   { label: 'Akce',    className: 'bg-purple-50 text-purple-700 border-purple-200' },
    druzina: { label: 'Družina', className: 'bg-teal-50 text-teal-700 border-teal-200' },
  }[type] ?? { label: type, className: 'bg-stone-100 text-stone-600 border-stone-200' }
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${map.className}`}>
      {map.label}
    </span>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-stone-100 last:border-0">
      <span className="text-sm text-stone-500 shrink-0">{label}</span>
      <span className="text-sm text-stone-900 text-right font-medium">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-5">
      <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
        {title}
      </h2>
      {children}
    </div>
  )
}

export default async function PohledavkaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDir && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') redirect('/dashboard')

  const { id } = await params
  const obligation = await fetchObligation(id)
  if (!obligation) notFound()

  const qrUrl = obligation.ss_kod
    ? payliboUrl({
        amount:  obligation.amount,
        vs:      obligation.vs,
        ss:      obligation.ss_kod,
        message: obligation.popis ?? '',
      })
    : null

  const canMatch = obligation.status !== 'paid'

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-3xl mx-auto space-y-4">

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-stone-400 mb-1">
            <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
              Platby
            </Link>
            <span>/</span>
            <Link href="/dashboard/platby/pohledavky" className="hover:text-stone-600 transition-colors">
              Pohledávky
            </Link>
            <span>/</span>
            <span className="text-stone-600 font-mono text-xs">{id.slice(0, 8)}…</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold text-stone-900">
              {obligation.student.last_name} {obligation.student.first_name}
            </h1>
            <TypeBadge type={obligation.type} />
            <StatusBadge status={obligation.status} />
          </div>
          <p className="text-sm text-stone-500 mt-0.5">{obligation.popis}</p>
        </div>
      </div>

      <Section title="Pohledávka">
        <DetailRow label="Žák" value={
          <span className="font-mono text-xs text-stone-400">{obligation.student.kod_zaka}</span>
        } />
        <DetailRow label="Variabilní symbol" value={
          <span className="font-mono">{obligation.vs}</span>
        } />
        {obligation.ss_kod && (
          <DetailRow label="Specifický symbol" value={
            <span className="flex items-center justify-end gap-2">
              <span className="font-mono">{obligation.ss_kod}</span>
              <Link
                href={`/dashboard/platby/akce/${encodeURIComponent(obligation.ss_kod)}`}
                className="text-xs font-medium text-stone-500 hover:text-stone-800 underline underline-offset-2 transition-colors"
              >
                Zobrazit celou akci →
              </Link>
            </span>
          } />
        )}
        <DetailRow label="Částka" value={formatCurrency(obligation.amount)} />
        <DetailRow label="Splatnost" value={formatDate(obligation.due_date)} />
        <DetailRow label="Školní rok" value={obligation.school_year} />
        <DetailRow
          label="Uhrazeno"
          value={
            <span className={obligation.matched_total > 0 ? 'text-emerald-600' : 'text-stone-400'}>
              {formatCurrency(obligation.matched_total)}
            </span>
          }
        />
        {obligation.status === 'partial' && (
          <DetailRow
            label="Zbývá"
            value={<span className="text-amber-600">{formatCurrency(obligation.amount - obligation.matched_total)}</span>}
          />
        )}
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {qrUrl && (
          <Section title="QR platba">
            <div className="flex flex-col items-center gap-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="QR kód pro platbu"
                className="w-40 h-40 rounded-xl border border-stone-100"
              />
              <p className="text-xs text-stone-400 text-center">
                {process.env.NEXT_PUBLIC_BANK_ACCOUNT_NUMBER}/{process.env.NEXT_PUBLIC_BANK_CODE}
              </p>
            </div>
          </Section>
        )}

        <Section title="Notifikace">
          <div className="py-2 space-y-3">
            {obligation.notified_at ? (
              <p className="text-sm text-stone-500">
                Naposledy odesláno{' '}
                <span className="font-medium text-stone-700">{formatDate(obligation.notified_at)}</span>
              </p>
            ) : (
              <p className="text-sm text-stone-400">Notifikace dosud nebyla odeslána.</p>
            )}
            <NotifyButton obligationId={obligation.id} />
          </div>
        </Section>
      </div>

      {obligation.matches.length > 0 && (
        <Section title={`Spárované platby (${obligation.matches.length})`}>
          <div className="space-y-2">
            {obligation.matches.map((m) => (
              <div
                key={m.transactionId}
                className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">
                    {formatCurrency(m.matched_amount)}
                    {m.donation_amount > 0 && (
                      <span className="ml-2 text-xs font-medium text-blue-600">
                        + dar {formatCurrency(m.donation_amount)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-stone-400 truncate mt-0.5">
                    {m.counterparty_name ?? '—'}
                    {m.transaction_date && (
                      <span className="ml-2">{formatDate(m.transaction_date)}</span>
                    )}
                  </p>
                  <div className="mt-1.5">
                    <UnmatchButton transactionId={m.transactionId} obligationId={obligation.id} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-stone-400">{m.isManual ? 'ručně' : 'auto'}</span>
                  <Link
                    href={`/dashboard/platby/transakce/${m.transactionId}`}
                    className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    Detail →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {canMatch && (
        <Section title="Ruční párování">
          <ManualMatchForm
            obligationId={obligation.id}
            remainingAmount={obligation.amount - obligation.matched_total}
          />
        </Section>
      )}

    </div>
  )
}
