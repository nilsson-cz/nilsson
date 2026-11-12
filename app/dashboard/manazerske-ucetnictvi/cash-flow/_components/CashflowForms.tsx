'use client'

// Formuláře stránky Cash-flow: nastavení výhledu, ruční zůstatek, očekávané platby KÚ.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteDotaceVyhled, deleteZustatekRucne, generovatDotaceSablonu, saveCfNastaveni, saveDotaceVyhled, saveZustatekRucne,
} from '@/app/actions/mu-cashflow'

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'
const primary = `${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`
const secondary = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`
const label = 'flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400'

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: true; error?: string }>, okText = 'Uloženo.') => start(async () => {
    const res = await fn()
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: okText })
    router.refresh()
  })
  return { pending, run, msg, setMsg }
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span> : null
}

export function NastaveniForm({ initial }: { initial: { min: number; horizont: number; sablona: 'kvartalne' | 'provizorium' } }) {
  const [v, setV] = useState({ minZustatek: String(initial.min), horizont: String(initial.horizont), sablona: initial.sablona })
  const { pending, run, msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className={label}>Minimální zůstatek (Kč)
        <input value={v.minZustatek} onChange={(e) => setV({ ...v, minZustatek: e.target.value })} className={`${input} w-32`} />
      </label>
      <label className={label}>Horizont výhledu (měsíce)
        <input value={v.horizont} onChange={(e) => setV({ ...v, horizont: e.target.value })} className={`${input} w-20`} />
      </label>
      <label className={label}>Šablona plateb KÚ
        <select value={v.sablona} onChange={(e) => setV({ ...v, sablona: e.target.value as 'kvartalne' | 'provizorium' })} className={input}>
          <option value="kvartalne">kvartálně</option>
          <option value="provizorium">provizorium (měsíčně zpětně)</option>
        </select>
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveCfNastaveni(v))} className={secondary}>Uložit</button>
      <Msg msg={msg} />
    </div>
  )
}

export function ZustatekForm({ rucne }: { rucne: { datum: string; zustatek: number; poznamka: string | null }[] }) {
  const [v, setV] = useState({ datum: '', zustatek: '', poznamka: '' })
  const { pending, run, msg } = useAction()
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>Datum
          <input type="date" value={v.datum} onChange={(e) => setV({ ...v, datum: e.target.value })} className={input} />
        </label>
        <label className={label}>Zůstatek ke konci dne (Kč)
          <input value={v.zustatek} onChange={(e) => setV({ ...v, zustatek: e.target.value })} className={`${input} w-36`} />
        </label>
        <label className={label}>Poznámka
          <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} className={`${input} w-56`} placeholder="např. výpis FIO" />
        </label>
        <button type="button" disabled={pending} onClick={() => run(() => saveZustatekRucne(v))} className={secondary}>Uložit zůstatek</button>
        <Msg msg={msg} />
      </div>
      {rucne.length > 0 && (
        <ul className="text-xs text-gray-600 dark:text-stone-400">
          {rucne.map((r) => (
            <li key={r.datum} className="flex items-center gap-2">
              {new Date(r.datum).toLocaleDateString('cs-CZ')}: {Math.round(r.zustatek).toLocaleString('cs-CZ')} Kč (ručně{r.poznamka ? `, ${r.poznamka}` : ''})
              <button type="button" onClick={() => run(() => deleteZustatekRucne(r.datum), 'Smazáno.')} className="text-red-600 hover:underline">smazat</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export type DotaceRow = { id: string; datum: string; castka: number; obdobi_od: string; obdobi_do: string; zdroj: 'sablona' | 'rucne'; poznamka: string | null }

export function DotaceVyhled({ rows, dnes }: { rows: DotaceRow[]; dnes: string }) {
  const [v, setV] = useState({ datum: '', castka: '', obdobiOd: '', obdobiDo: '', poznamka: '' })
  const { pending, run, msg, setMsg } = useAction()
  const router = useRouter()
  const [genPending, startGen] = useTransition()
  const budouci = rows.filter((r) => r.datum >= dnes)

  const generovat = () => {
    if (budouci.some((r) => r.zdroj === 'sablona') && !confirm('Nahradit budoucí platby ze šablony novými? Ručně zadané zůstanou.')) return
    startGen(async () => {
      const res = await generovatDotaceSablonu()
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: `Vygenerováno ${res.radku} plateb (měsíční nárok ${res.mesicniNarok?.toLocaleString('cs-CZ')} Kč).` })
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={generovat} disabled={genPending} className={primary}>{genPending ? '…' : 'Vygenerovat ze šablony'}</button>
        <Msg msg={msg} />
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500 dark:text-stone-400">
          <tr><th className="py-1 text-left font-medium">Datum</th><th className="text-right font-medium">Částka</th><th className="pl-4 text-left font-medium">Kryje období</th><th className="text-left font-medium">Zdroj</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
          {budouci.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-gray-400">Žádné očekávané platby.</td></tr>}
          {budouci.map((r) => (
            <tr key={r.id} className="text-gray-700 dark:text-stone-300">
              <td className="py-1">{new Date(r.datum).toLocaleDateString('cs-CZ')}</td>
              <td className="text-right tabular-nums">{Math.round(r.castka).toLocaleString('cs-CZ')} Kč</td>
              <td className="pl-4">{r.obdobi_od === r.obdobi_do ? r.obdobi_od : `${r.obdobi_od} – ${r.obdobi_do}`}</td>
              <td className="text-xs text-gray-500">{r.zdroj === 'sablona' ? 'šablona' : 'ručně'}{r.poznamka && r.zdroj === 'rucne' ? ` · ${r.poznamka}` : ''}</td>
              <td className="text-right">
                <button type="button" disabled={pending} onClick={() => run(() => deleteDotaceVyhled(r.id), 'Smazáno.')} className="text-xs text-red-600 hover:underline">smazat</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3 dark:border-stone-800">
        <label className={label}>Datum platby
          <input type="date" value={v.datum} onChange={(e) => setV({ ...v, datum: e.target.value })} className={input} />
        </label>
        <label className={label}>Částka (Kč)
          <input value={v.castka} onChange={(e) => setV({ ...v, castka: e.target.value })} className={`${input} w-32`} />
        </label>
        <label className={label}>Období od
          <input type="month" value={v.obdobiOd} onChange={(e) => setV({ ...v, obdobiOd: e.target.value, obdobiDo: v.obdobiDo || e.target.value })} className={input} />
        </label>
        <label className={label}>do
          <input type="month" value={v.obdobiDo} onChange={(e) => setV({ ...v, obdobiDo: e.target.value })} className={input} />
        </label>
        <label className={label}>Poznámka
          <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} className={`${input} w-48`} placeholder="např. avízo KÚ" />
        </label>
        <button type="button" disabled={pending} onClick={() => run(() => saveDotaceVyhled(v), 'Platba přidána.')} className={secondary}>Přidat platbu</button>
      </div>
    </div>
  )
}
