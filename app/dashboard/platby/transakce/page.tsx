// app/dashboard/platby/transakce/page.tsx
// Server Component — filtry jako URL search params (žádný client state).
// Nový param: ?zobrazit=vse  →  zobrazí i ignorované transakce (zašedlé)

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { IgnoreButton } from './_components/IgnoreButton'

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency }).format(amount)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('cs-CZ')
}

interface SearchParams {
  match_status?: string
  zobrazit?: string
}

interface TransactionRow {
  id: string
  amount: number
  currency: string
  transaction_date: string
  variable_symbol: string | null
  specific_symbol: string | null
  match_status: string
  ignored: boolean
}

export default async function TransakcePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const zobrazitVse = params.zobrazit === 'vse'
  const filterStatus = params.match_status // undefined = vše

  // Sestavení dotazu
  let query = supabase
    .from('payment_transactions')
    .select('id, amount, currency, transaction_date, variable_symbol, specific_symbol, match_status, ignored')
    .order('transaction_date', { ascending: false })

  // Defaultně skrýváme ignorované; ?zobrazit=vse je ukáže
  // `any` cast: sloupec `ignored` přidán migrací 024 — typy regenerovat po `supabase db push`
  let anyQuery = query as any
  if (!zobrazitVse) {
    anyQuery = anyQuery.eq('ignored', false)
  }

  if (filterStatus) {
    anyQuery = anyQuery.eq('match_status', filterStatus)
  }

  const { data: transakce, error } = await anyQuery as { data: TransactionRow[] | null, error: unknown }

  if (error) {
    return <p className="text-red-600">Chyba při načítání transakcí: {(error as any)?.message}</p>
  }

  // Počet ignorovaných — pro odkaz "Zobrazit ignorované (N)"
  const { count: ignoredCount } = await supabase
    .from('payment_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('ignored', true)

  // URL helpery pro přepínání filtrů bez ztráty ostatních params
  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (params.match_status) p.set('match_status', params.match_status)
    if (params.zobrazit) p.set('zobrazit', params.zobrazit)
    Object.entries(overrides).forEach(([k, v]) => {
      if (v === undefined) p.delete(k)
      else p.set(k, v)
    })
    const str = p.toString()
    return `/dashboard/platby/transakce${str ? `?${str}` : ''}`
  }

  const matchStatusLabels: Record<string, string> = {
    matched: 'Spárováno',
    partial: 'Částečně',
    unmatched: 'Nespárováno',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transakce</h1>
        <Link
          href="/dashboard/platby/transakce"
          className="text-sm text-blue-600 hover:underline"
        >
          ← Zpět na přehled plateb
        </Link>
      </div>

      {/* Filtry */}
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-gray-500">Stav:</span>
        {['', 'unmatched', 'partial', 'matched'].map((status) => (
          <Link
            key={status || 'vše'}
            href={buildUrl({ match_status: status || undefined })}
            className={`px-2 py-0.5 rounded border ${
              (filterStatus ?? '') === status
                ? 'bg-gray-800 text-white border-gray-800'
                : 'border-gray-300 hover:border-gray-500'
            }`}
          >
            {status ? matchStatusLabels[status] : 'Vše'}
          </Link>
        ))}

        <span className="ml-4 text-gray-300">|</span>

        {/* Přepínač ignorovaných */}
        {zobrazitVse ? (
          <Link
            href={buildUrl({ zobrazit: undefined })}
            className="px-2 py-0.5 rounded border border-gray-300 hover:border-gray-500"
          >
            Skrýt ignorované
          </Link>
        ) : (
          <Link
            href={buildUrl({ zobrazit: 'vse' })}
            className="px-2 py-0.5 rounded border border-gray-300 hover:border-gray-500 text-gray-500"
          >
            Zobrazit ignorované {ignoredCount ? `(${ignoredCount})` : ''}
          </Link>
        )}
      </div>

      {/* Tabulka */}
      {transakce && transakce.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                <th className="py-2 pr-4">Datum</th>
                <th className="py-2 pr-4">Částka</th>
                <th className="py-2 pr-4">VS</th>
                <th className="py-2 pr-4">SS</th>
                <th className="py-2 pr-4">Stav</th>
                <th className="py-2 pr-4">Detail</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {transakce.map((tx) => (
                <tr
                  key={tx.id}
                  className={`border-b ${
                    tx.ignored
                      ? 'opacity-40 bg-gray-50'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="py-2 pr-4 text-gray-600">{formatDate(tx.transaction_date)}</td>
                  <td className="py-2 pr-4 font-mono">
                    {formatCurrency(tx.amount, tx.currency)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-600">
                    {tx.variable_symbol ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-600">
                    {tx.specific_symbol ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 pr-4">
                    {tx.ignored ? (
                      <span className="text-xs text-gray-400 italic">ignorováno</span>
                    ) : (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${
                          tx.match_status === 'matched'
                            ? 'bg-green-100 text-green-700'
                            : tx.match_status === 'partial'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {matchStatusLabels[tx.match_status] ?? tx.match_status}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/dashboard/platby/transakce/${tx.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      Detail
                    </Link>
                  </td>
                  <td className="py-2 text-right">
                    <IgnoreButton
                      transactionId={tx.id}
                      ignored={tx.ignored}
                      matchStatus={tx.match_status}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-sm py-8 text-center">
          {zobrazitVse ? 'Žádné transakce.' : 'Žádné aktivní transakce.'}
        </p>
      )}
    </div>
  )
}
