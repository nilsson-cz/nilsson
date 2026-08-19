/**
 * app/dashboard/platby/transakce/[id]/page.tsx
 *
 * Server Component — detail transakce + ruční párování.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import ManualMatchForm from './_components/ManualMatchForm'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type MatchStatus = 'matched' | 'unmatched' | 'manual_override'

type TransactionDetail = {
  id: string
  fioTransactionId: string
  amount: number
  currency: string
  transactionDate: string
  counterpartyName: string | null
  counterpartyAccount: string | null
  variableSymbol: string | null
  specificSymbol: string | null
  note: string | null
  matchStatus: MatchStatus
  importedAt: string
  student: {
    id: string
    firstName: string
    lastName: string
    kodZaka: string
  } | null
  matches: {
    id: string
    obligationId: string
    matchedAmount: number
    matchedAt: string
    isManual: boolean
    obligationPopis: string | null
  }[]
}

export type ObligationOption = {
  id: string
  popis: string | null
  amount: number
  dueDate: string
  ssKod: string | null
  studentName: string
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchTransaction(id: string): Promise<TransactionDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data: raw, error } = await supabase
    .from('payment_transactions')
    .select(`
      id, fio_transaction_id, amount, currency, transaction_date,
      counterparty_name, counterparty_account,
      variable_symbol, specific_symbol, note, match_status, imported_at,
      students ( id, first_name, last_name, kod_zaka )
    `)
    .eq('id', id)
    .single()

  if (error || !raw) return null

  // Načíst existující matches
  const { data: matchesRaw } = await supabase
    .from('payment_matches')
    .select(`
      id, obligation_id, matched_amount, matched_at, matched_by,
      payment_obligations ( popis )
    `)
    .eq('transaction_id', id)
    .order('matched_at', { ascending: false })

  const matches = (matchesRaw as any[] ?? []).map((m: any) => ({
    id:              m.id,
    obligationId:    m.obligation_id,
    matchedAmount:   Number(m.matched_amount),
    matchedAt:       m.matched_at,
    isManual:        !!m.matched_by,
    obligationPopis: m.payment_obligations?.popis ?? null,
  }))

  return {
    id:                  raw.id,
    fioTransactionId:    raw.fio_transaction_id,
    amount:              Number(raw.amount),
    currency:            raw.currency,
    transactionDate:     raw.transaction_date,
    counterpartyName:    raw.counterparty_name,
    counterpartyAccount: raw.counterparty_account,
    variableSymbol:      raw.variable_symbol,
    specificSymbol:      raw.specific_symbol,
    note:                raw.note,
    matchStatus:         raw.match_status as MatchStatus,
    importedAt:          raw.imported_at,
    // Mapování snake→camel: raw.students má DB názvy (first_name…), ale
    // TransactionDetail.student je camelCase a JSX ho tak čte. Bez mapování by
    // se jméno/kód žáka renderovaly prázdné (dřív skryto pod as-any castem).
    student: raw.students
      ? {
          id:        raw.students.id,
          firstName: raw.students.first_name,
          lastName:  raw.students.last_name,
          kodZaka:   raw.students.kod_zaka,
        }
      : null,
    matches,
  }
}

async function fetchObligationsForMatch(
  studentId: string | null,
): Promise<ObligationOption[]> {
  const supabase = await createSupabaseServerClient()

  // Nabízíme jen nespárované pohledávky — tzn. ty, u nichž součet dosavadních
  // párování nepokrývá celou částku (stav pending/partial). Plně splacené
  // pohledávky by při ručním párování transakce jen mátly.
  const { data } = await supabase
    .from('payment_obligations')
    .select(`
      id, popis, amount, due_date, ss_kod,
      students ( first_name, last_name )
    `)
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .order('due_date', { ascending: false })

  const rows = (data as any[]) ?? []
  if (rows.length === 0) return []

  // Součty dosavadních párování pro tyto pohledávky (stejný postup jako
  // seznam pohledávek — stav se odvozuje z payment_matches, ne ze sloupce)
  const ids = rows.map((o: any) => o.id)
  const { data: matchesRaw } = await supabase
    .from('payment_matches')
    .select('obligation_id, matched_amount')
    .in('obligation_id', ids)

  const matchedTotal: Record<string, number> = {}
  ;(matchesRaw as any[] ?? []).forEach((m: any) => {
    matchedTotal[m.obligation_id] =
      (matchedTotal[m.obligation_id] ?? 0) + Number(m.matched_amount)
  })

  return rows
    .filter((o: any) => (matchedTotal[o.id] ?? 0) < Number(o.amount))
    .map((o: any) => ({
      id:          o.id,
      popis:       o.popis,
      amount:      Number(o.amount),
      dueDate:     o.due_date,
      ssKod:       o.ss_kod,
      studentName: o.students
        ? `${o.students.last_name} ${o.students.first_name}`
        : '—',
    }))
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const map = {
    matched:         { label: 'Spárováno',   className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    unmatched:       { label: 'Nespárováno', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    manual_override: { label: 'Ruční match', className: 'bg-purple-50 text-purple-700 border-purple-200' },
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
      <span className="text-sm font-medium text-stone-900 text-right break-all">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

export default async function TransakceDetailPage({
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
  const [tx, obligations] = await Promise.all([
    fetchTransaction(id),
    fetchObligationsForMatch(null),
  ])
  if (!tx) notFound()

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-stone-400 mb-6">
        <Link href="/dashboard/platby" className="hover:text-stone-600 transition-colors">
          Platby
        </Link>
        <span>/</span>
        <Link href="/dashboard/platby/transakce" className="hover:text-stone-600 transition-colors">
          Transakce
        </Link>
        <span>/</span>
        <span className="text-stone-600 font-mono text-xs">{tx.fioTransactionId}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">
            {tx.counterpartyName ?? 'Neznámý plátce'}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {new Date(tx.transactionDate).toLocaleDateString('cs-CZ', {
              day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-bold ${tx.amount >= 0 ? 'text-stone-900' : 'text-red-600'}`}>
            {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString('cs-CZ')} {tx.currency}
          </span>
          <MatchStatusBadge status={tx.matchStatus} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Detail transakce */}
        <div className="lg:col-span-2 space-y-4">
          <Section title="Detail transakce">
            <InfoRow label="Fio ID"          value={<span className="font-mono text-xs">{tx.fioTransactionId}</span>} />
            <InfoRow label="Datum"            value={new Date(tx.transactionDate).toLocaleDateString('cs-CZ')} />
            <InfoRow label="Částka"           value={`${tx.amount.toLocaleString('cs-CZ')} ${tx.currency}`} />
            <InfoRow label="Plátce"           value={tx.counterpartyName ?? '—'} />
            <InfoRow label="Účet plátce"      value={<span className="font-mono text-xs">{tx.counterpartyAccount ?? '—'}</span>} />
            <InfoRow label="Variabilní symbol" value={<span className="font-mono">{tx.variableSymbol ?? '—'}</span>} />
            <InfoRow label="Specifický symbol" value={<span className="font-mono">{tx.specificSymbol ?? '—'}</span>} />
            {tx.note && <InfoRow label="Poznámka" value={tx.note} />}
            <InfoRow
              label="Importováno"
              value={new Date(tx.importedAt).toLocaleDateString('cs-CZ', {
                day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            />
          </Section>

          {/* Identifikovaný žák */}
          {tx.student && (
            <Section title="Identifikovaný žák">
              <InfoRow
                label="Jméno"
                value={
                  <Link
                    href={`/dashboard/zaci/${tx.student.id}`}
                    className="text-stone-800 hover:text-stone-600 underline underline-offset-2 transition-colors"
                  >
                    {tx.student.lastName} {tx.student.firstName}
                  </Link>
                }
              />
              <InfoRow
                label="Kód žáka"
                value={<span className="font-mono">{tx.student.kodZaka}</span>}
              />
            </Section>
          )}

          {/* Existující matches */}
          {tx.matches.length > 0 && (
            <Section title="Párování">
              <div className="space-y-2">
                {tx.matches.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-stone-50">
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {m.obligationPopis ?? 'Pohledávka'}
                      </p>
                      <p className="text-xs text-stone-400">
                        {new Date(m.matchedAt).toLocaleDateString('cs-CZ')}
                        {m.isManual && <span className="ml-2 text-purple-500">ruční</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-emerald-600">
                        {m.matchedAmount.toLocaleString('cs-CZ')} {tx.currency}
                      </p>
                      <Link
                        href={`/dashboard/platby/pohledavky/${m.obligationId}`}
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
        </div>

        {/* Ruční párování */}
        <div>
          {tx.matchStatus === 'unmatched' && (
            <Section title="Ruční párování">
              <ManualMatchForm
                transactionId={tx.id}
                transactionAmount={tx.amount}
                currency={tx.currency}
                obligations={obligations}
                preselectedStudentId={tx.student?.id ?? null}
              />
            </Section>
          )}

          {tx.matchStatus !== 'unmatched' && (
            <Section title="Párování">
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-stone-500">Transakce je spárována</p>
                <p className="text-xs text-stone-400 mt-1">
                  {tx.matchStatus === 'manual_override' ? 'Ruční párování' : 'Automatické párování'}
                </p>
              </div>
            </Section>
          )}
        </div>

      </div>
    </div>
  )
}
