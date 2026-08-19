/**
 * lib/fio.ts
 * Fio banka REST API client.
 * Dokumentace: https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf
 *
 * Používáme endpoint /last/ — vrátí transakce od posledního volání.
 * Fio si pamatuje "kurzor" per token, takže každé volání vrátí
 * pouze nové transakce od předchozího importu.
 */

export interface FioTransaction {
  fioTransactionId: string
  date: string              // 'YYYY-MM-DD'
  amount: number
  currency: string
  counterpartyAccount: string | null
  counterpartyName: string | null
  variableSymbol: string | null
  specificSymbol: string | null  // ← přidáno
  note: string | null
}

interface FioApiTransaction {
  column22: { value: number } | null   // ID pohybu
  column0:  { value: string } | null   // Datum
  column1:  { value: number } | null   // Objem
  column14: { value: string } | null   // Měna
  column2:  { value: string } | null   // Protiúčet
  column10: { value: string } | null   // Název protiúčtu
  column5:  { value: string } | null   // VS
  column6:  { value: string } | null   // SS ← přidáno
  column25: { value: string } | null   // Komentář
}

export async function fetchFioTransactions(token: string, from?: string): Promise<FioTransaction[]> {
  const today = new Date().toISOString().slice(0, 10)
  const url = from
    ? `https://fioapi.fio.cz/v1/rest/periods/${token}/${from}/${today}/transactions.json`
    : `https://fioapi.fio.cz/v1/rest/last/${token}/transactions.json`

  const res = await fetch(url, {
    // Fio API nemá CORS — voláme ze serveru, takže OK
    headers: { 'Accept': 'application/json' },
    // Next.js cache: no-store — vždy čerstvá data
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Fio API chyba: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  const transactions: FioApiTransaction[] =
    json?.accountStatement?.transactionList?.transaction ?? []

  return transactions.map((t) => ({
    fioTransactionId: String(t.column22?.value ?? ''),
    date:             (t.column0?.value ?? '').slice(0, 10),  // '2026-05-14T00:00:00+02:00' → '2026-05-14'
    amount:           t.column1?.value ?? 0,
    currency:         t.column14?.value ?? 'CZK',
    counterpartyAccount: t.column2?.value ?? null,
    counterpartyName:    t.column10?.value ?? null,
    variableSymbol:      t.column5?.value ?? null,
    specificSymbol:      t.column6?.value ?? null,  // ← přidáno
    note:                t.column25?.value ?? null,
  }))
}