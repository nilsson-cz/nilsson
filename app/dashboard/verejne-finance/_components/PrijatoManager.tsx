'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteVfPrijato, saveVfKuUcty, saveVfPrijato } from '@/app/actions/verejne-finance'

export type PrijatoRow = {
  id: string
  datum: string
  castka: number
  obdobi_od: string
  obdobi_do: string
  izo_id: string | null
  payment_transaction_id: string | null
  poznamka: string | null
}

export type FioSuggestion = {
  id: string
  datum: string
  castka: number
  protistrana: string
  zprava: string
}

type Form = {
  id?: string
  datum: string
  castka: string
  obdobiOd: string
  obdobiDo: string
  izoId: string
  paymentTransactionId: string | null
  poznamka: string
}

const EMPTY: Form = { datum: '', castka: '', obdobiOd: '', obdobiDo: '', izoId: '', paymentTransactionId: null, poznamka: '' }
const inputCls = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'
const kc = (n: number) => `${n.toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kč`
const d = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ')

export default function PrijatoManager({
  records, izoOptions, suggestions, kuUcty,
}: {
  records: PrijatoRow[]
  izoOptions: { id: string; nazev: string }[]
  suggestions: FioSuggestion[]
  kuUcty: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<Form>(EMPTY)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [ucty, setUcty] = useState(kuUcty.join(', '))
  const [uctyMsg, setUctyMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const izoName = (id: string | null) => izoOptions.find((o) => o.id === id)?.nazev ?? 'souhrnně'
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await saveVfPrijato(form)
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      setMsg({ ok: true, text: form.id ? 'Uloženo.' : 'Platba přidána.' })
      setForm(EMPTY)
      router.refresh()
    })
  }

  const remove = (id: string) => {
    if (!confirm('Smazat záznam o přijaté platbě?')) return
    startTransition(async () => {
      const res = await deleteVfPrijato(id)
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: 'Smazáno.' })
      router.refresh()
    })
  }

  const edit = (r: PrijatoRow) => {
    setForm({
      id: r.id, datum: r.datum, castka: String(r.castka), obdobiOd: r.obdobi_od, obdobiDo: r.obdobi_do,
      izoId: r.izo_id ?? '', paymentTransactionId: r.payment_transaction_id, poznamka: r.poznamka ?? '',
    })
    setMsg(null)
  }

  const take = (s: FioSuggestion) => {
    const month = s.datum.slice(0, 7)
    setForm({
      datum: s.datum, castka: String(s.castka), obdobiOd: month, obdobiDo: month, izoId: '',
      paymentTransactionId: s.id, poznamka: [s.protistrana, s.zprava].filter(Boolean).join(' · '),
    })
    setMsg({ ok: true, text: 'Předvyplněno z FIO — upravte období, za které platba je, a uložte.' })
  }

  const saveUcty = () => startTransition(async () => {
    const res = await saveVfKuUcty(ucty)
    setUctyMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: '✓' })
    router.refresh()
  })

  return (
    <div className="space-y-8">
      {/* Formulář */}
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-stone-700">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">
          {form.id ? 'Upravit platbu' : 'Přidat přijatou platbu'}
          {form.paymentTransactionId && <span className="ml-2 text-xs font-normal text-sky-600">z FIO importu</span>}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Datum připsání
            <input type="date" value={form.datum} onChange={set('datum')} className={inputCls} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Částka (Kč, vratka záporně)
            <input value={form.castka} onChange={set('castka')} inputMode="decimal" className={`w-36 ${inputCls}`} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Za období od
            <input type="month" value={form.obdobiOd} onChange={set('obdobiOd')} className={inputCls} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            do
            <input type="month" value={form.obdobiDo} onChange={set('obdobiDo')} className={inputCls} required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Činnost
            <select value={form.izoId} onChange={set('izoId')} className={inputCls}>
              <option value="">souhrnně (bez rozlišení IZO)</option>
              {izoOptions.map((o) => <option key={o.id} value={o.id}>{o.nazev}</option>)}
            </select>
          </label>
          <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Poznámka
            <input value={form.poznamka} onChange={set('poznamka')} placeholder="např. záloha Q4, vyúčtování 2026" className={inputCls} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button disabled={pending}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
            {pending ? '…' : form.id ? 'Uložit změny' : 'Přidat'}
          </button>
          {(form.id || form.paymentTransactionId || form.datum) && (
            <button type="button" onClick={() => { setForm(EMPTY); setMsg(null) }}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 dark:text-stone-300 dark:hover:bg-stone-800">
              Zrušit
            </button>
          )}
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
        <p className="text-xs text-gray-500 dark:text-stone-400">
          Pro srovnání s nárokem se částka rozpočítá rovnoměrně do měsíců zvoleného období (např. čtvrtletní záloha → 3 měsíce).
        </p>
      </form>

      {/* Seznam */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Evidované platby</h2>
        {records.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-stone-400">Zatím žádná přijatá platba.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 dark:bg-stone-900/60 dark:text-stone-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Připsáno</th>
                  <th className="px-3 py-2 text-right font-medium">Částka</th>
                  <th className="px-3 py-2 font-medium">Za období</th>
                  <th className="px-3 py-2 font-medium">Činnost</th>
                  <th className="px-3 py-2 font-medium">Poznámka</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
                {records.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-800 dark:text-stone-200">
                      {d(r.datum)}
                      {r.payment_transaction_id && <span className="ml-1.5 text-[11px] text-sky-600">FIO</span>}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.castka < 0 ? 'text-red-600' : 'text-gray-900 dark:text-stone-100'}`}>
                      {kc(r.castka)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-stone-300">
                      {r.obdobi_od === r.obdobi_do ? r.obdobi_od : `${r.obdobi_od} – ${r.obdobi_do}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700 dark:text-stone-300">{izoName(r.izo_id)}</td>
                    <td className="max-w-64 truncate px-3 py-2 text-gray-500 dark:text-stone-400" title={r.poznamka ?? undefined}>{r.poznamka}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => edit(r)} className="text-xs text-gray-600 hover:text-gray-900 dark:text-stone-300">Upravit</button>
                      <button type="button" onClick={() => remove(r.id)} disabled={pending}
                        className="ml-3 text-xs text-red-600 hover:text-red-800">Smazat</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Návrhy z FIO */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-stone-100">Návrhy z FIO importu</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-stone-400">
            Účty krajského úřadu, ze kterých chodí dotace
            <input value={ucty} onChange={(e) => { setUcty(e.target.value); setUctyMsg(null) }}
              placeholder="např. 1234567890/0100" className={`w-96 max-w-full ${inputCls}`} />
          </label>
          <button type="button" onClick={saveUcty} disabled={pending}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
            Uložit účty
          </button>
          {uctyMsg && <span className={`text-sm ${uctyMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{uctyMsg.text}</span>}
        </div>
        {kuUcty.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-stone-400">
            Zadejte účet KÚ a IS nabídne příchozí platby z něj k převzetí jedním klikem.
            Převzatá transakce se v modulu Platby označí jako ignorovaná (smazáním záznamu se tam vrátí).
          </p>
        ) : suggestions.length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-stone-400">Z uvedených účtů není žádná nepřevzatá příchozí platba. (Návrhy fungují, jen pokud dotace chodí na účet napojený na FIO import.)</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 dark:divide-stone-800 dark:border-stone-700">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-gray-800 dark:text-stone-200">
                  {d(s.datum)} · <span className="tabular-nums font-medium">{kc(s.castka)}</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-stone-400">{[s.protistrana, s.zprava].filter(Boolean).join(' · ')}</span>
                </span>
                <button type="button" onClick={() => take(s)}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800">
                  Převzít
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
