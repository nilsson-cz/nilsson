/**
 * app/dashboard/platby/page.tsx
 *
 * Server Component — přehled platebního modulu.
 * Zobrazuje: nesplacené pohledávky, nespárované transakce, přeplatky.
 */

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// ---------------------------------------------------------------------------
// Typy
// ---------------------------------------------------------------------------

type ObligationRow = {
  id: string
  popis: string | null
  amount: number
  due_date: string
  student: { first_name: string; last_name: string; kod_zaka: string } | null
  matched_total: number
}

type TransactionRow = {
  id: string
  amount: number
  currency: string
  transaction_date: string
  counterparty_name: string | null
  variable_symbol: string | null
  specific_symbol: string | null
}

type DashboardData = {
  unpaidObligations: ObligationRow[]
  unmatchedTransactions: TransactionRow[]
  overpayments: ObligationRow[]
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function fetchPaymentsDashboard(): Promise<DashboardData> {
  const supabase = await createSupabaseServerClient()

  const [
    { data: obligationsRaw },
    { data: unmatchedRaw },
    { data: matchSumsRaw },
  ] = await Promise.all([
    // Pohledávky aktuálního školního roku
    supabase
      .from('payment_obligations')
      .select(`
        id, popis, amount, due_date,
        students ( first_name, last_name, kod_zaka )
      `)
      .eq('school_year', CURRENT_SCHOOL_YEAR)
      .order('due_date', { ascending: true }),

    // Nespárované transakce (ignorované se nezobrazují)
    supabase
      .from('payment_transactions')
      .select('id, amount, currency, transaction_date, counterparty_name, variable_symbol, specific_symbol')
      .eq('match_status', 'unmatched')
      .eq('ignored', false)
      .order('transaction_date', { ascending: false }),

    // Součty spárovaných částek per pohledávka
    supabase
      .from('payment_matches')
      .select('obligation_id, matched_amount'),
  ])

  // Spočítat matched_total per obligation
  const matchMap: Record<string, number> = {}
  ;(matchSumsRaw as any[] ?? []).forEach((m: any) => {
    matchMap[m.obligation_id] = (matchMap[m.obligation_id] ?? 0) + Number(m.matched_amount)
  })

  const obligations: ObligationRow[] = (obligationsRaw as any[] ?? []).map((o: any) => ({
    id:            o.id,
    popis:         o.popis,
    amount:        Number(o.amount),
    due_date:      o.due_date,
    student:       o.students ?? null,
    matched_total: matchMap[o.id] ?? 0,
  }))

  // Nesplacené = pending + partial
  const unpaidObligations = obligations.filter(
    (o) => o.matched_total < o.amount,
  )

  // Přeplatky = matched_total > amount
  const overpayments = obligations.filter(
    (o) => o.matched_total > o.amount,
  )

  return {
    unpaidObligations,
    unmatchedTransactions: unmatchedRaw as TransactionRow[] ?? [],
    overpayments,
  }
}

// ---------------------------------------------------------------------------
// UI komponenty
// ---------------------------------------------------------------------------

function WidgetCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-white rounded-2xl border border-stone-200 p-5 ${className}`}>
      {children}
    </div>
  )
}

function WidgetHeader({
  title,
  action,
}: {
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wide">
        {title}
      </h2>
      {action}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 py-3">
      <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
        <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <p className="text-sm text-stone-500">{text}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: 'pending' | 'partial' }) {
  const styles = {
    pending: 'bg-amber-50 text-amber-700',
    partial: 'bg-blue-50 text-blue-700',
  }[status]
  const label = status === 'pending' ? 'Nesplaceno' : 'Částečně'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Widget: Nesplacené pohledávky
// ---------------------------------------------------------------------------

function UnpaidObligationsWidget({ obligations }: { obligations: ObligationRow[] }) {
  const pending = obligations.filter((o) => o.matched_total === 0)
  const partial = obligations.filter((o) => o.matched_total > 0)

  return (
    <WidgetCard className="lg:col-span-2">
      <WidgetHeader
        title="Nesplacené pohledávky"
        action={
          <div className="flex items-center gap-3">
            {obligations.length > 0 && (
              <span className="text-xs font-medium text-stone-400">
                {obligations.length} celkem
              </span>
            )}
            <Link
              href="/dashboard/platby/pohledavky/nova"
              className="text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              + Nová
            </Link>
          </div>
        }
      />

      {obligations.length === 0 ? (
        <EmptyState text="Všechny pohledávky jsou splaceny" />
      ) : (
        <div className="space-y-2">
          {[...pending, ...partial].slice(0, 8).map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/platby/pohledavky/${o.id}`}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-stone-50 hover:bg-stone-100 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <StatusBadge status={o.matched_total === 0 ? 'pending' : 'partial'} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">
                    {o.student
                      ? `${o.student.last_name} ${o.student.first_name}`
                      : '—'}
                  </p>
                  <p className="text-xs text-stone-400 truncate">{o.popis ?? '—'}</p>
                </div>
              </div>
              <div className="text-right ml-4 shrink-0">
                <p className="text-sm font-semibold text-stone-900">
                  {o.amount - o.matched_total} Kč
                </p>
                <p className="text-xs text-stone-400">
                  do {new Date(o.due_date).toLocaleDateString('cs-CZ')}
                </p>
              </div>
            </Link>
          ))}

          {obligations.length > 8 && (
            <Link
              href="/dashboard/platby/pohledavky"
              className="block text-center text-xs text-stone-400 hover:text-stone-600 pt-1 transition-colors"
            >
              Zobrazit všech {obligations.length} →
            </Link>
          )}
        </div>
      )}
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Widget: Nespárované transakce
// ---------------------------------------------------------------------------

function UnmatchedTransactionsWidget({
  transactions,
}: {
  transactions: TransactionRow[]
}) {
  return (
    <WidgetCard>
      <WidgetHeader
        title="Nespárované transakce"
        action={
          transactions.length > 0 ? (
            <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
              {transactions.length}
            </span>
          ) : null
        }
      />

      {transactions.length === 0 ? (
        <EmptyState text="Žádné nespárované transakce" />
      ) : (
        <div className="space-y-2">
          {transactions.slice(0, 5).map((tx) => (
            <Link
              key={tx.id}
              href={`/dashboard/platby/transakce/${tx.id}`}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-amber-50 hover:bg-amber-100 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">
                  {tx.counterparty_name ?? 'Neznámý plátce'}
                </p>
                <p className="text-xs text-stone-400">
                  VS: {tx.variable_symbol ?? '—'} · SS: {tx.specific_symbol ?? '—'}
                </p>
              </div>
              <div className="text-right ml-4 shrink-0">
                <p className="text-sm font-semibold text-stone-900">
                  {tx.amount} {tx.currency}
                </p>
                <p className="text-xs text-stone-400">
                  {new Date(tx.transaction_date).toLocaleDateString('cs-CZ')}
                </p>
              </div>
            </Link>
          ))}

          {transactions.length > 5 && (
            <Link
              href="/dashboard/platby/transakce"
              className="block text-center text-xs text-stone-400 hover:text-stone-600 pt-1 transition-colors"
            >
              Zobrazit všech {transactions.length} →
            </Link>
          )}
        </div>
      )}
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Widget: Přeplatky
// ---------------------------------------------------------------------------

function OverpaymentsWidget({ overpayments }: { overpayments: ObligationRow[] }) {
  return (
    <WidgetCard>
      <WidgetHeader
        title="Přeplatky"
        action={
          overpayments.length > 0 ? (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {overpayments.length}
            </span>
          ) : null
        }
      />

      {overpayments.length === 0 ? (
        <EmptyState text="Žádné přeplatky" />
      ) : (
        <div className="space-y-2">
          {overpayments.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/platby/pohledavky/${o.id}`}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800 truncate">
                  {o.student
                    ? `${o.student.last_name} ${o.student.first_name}`
                    : '—'}
                </p>
                <p className="text-xs text-stone-400 truncate">{o.popis ?? '—'}</p>
              </div>
              <div className="text-right ml-4 shrink-0">
                <p className="text-sm font-semibold text-blue-700">
                  +{o.matched_total - o.amount} Kč
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function PlatbyPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isDir } = await supabase.rpc('is_director')
  // Demo: v read-only demu (NEXT_PUBLIC_DEMO_MODE) smí číst i readonly inspektor.
  if (!isDir && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') redirect('/dashboard')

  const { unpaidObligations, unmatchedTransactions, overpayments } =
    await fetchPaymentsDashboard()

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Platby</h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Školní rok {CURRENT_SCHOOL_YEAR} · ZŠ Vilekula Teplice
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/platby/akce"
            className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
          >
            Akce →
          </Link>
          <Link
            href="/dashboard/platby/transakce"
            className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
          >
            Všechny transakce →
          </Link>
          <Link
            href="/dashboard/platby/pohledavky"
            className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
          >
            Všechny pohledávky →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <UnpaidObligationsWidget obligations={unpaidObligations} />
        <UnmatchedTransactionsWidget transactions={unmatchedTransactions} />
        <OverpaymentsWidget overpayments={overpayments} />
      </div>
    </div>
  )
}
