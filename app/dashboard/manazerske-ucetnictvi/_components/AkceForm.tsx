'use client'

// Formulář akce / grantu (F3): název, termín, SS kódy plateb, zakázka ABRA,
// rozpočet akce, personální náklady (D8/D9), archivace a smazání.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { archivAkce, deleteAkce, saveAkce, type AkceInput } from '@/app/actions/mu-akce'

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'
const label = 'flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'
const primary = `${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`
const secondary = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`

export type SsOption = { ss: string; popis: string; predepsano: number; obsazeno: boolean }

export default function AkceForm({
  initial, ssOptions, zakazkaOptions, archiv, baseHref,
}: {
  initial: AkceInput
  ssOptions: SsOption[]
  zakazkaOptions: { kod: string; nazev: string | null }[]
  archiv?: boolean
  baseHref: string
}) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof AkceInput>(k: K, val: AkceInput[K]) => setV((s) => ({ ...s, [k]: val }))
  const toggleSs = (ss: string) => set('ssKody', v.ssKody.includes(ss) ? v.ssKody.filter((x) => x !== ss) : [...v.ssKody, ss])

  const ulozit = () => start(async () => {
    const res = await saveAkce(v)
    if (res.error) { setMsg({ ok: false, text: res.error }); return }
    setMsg({ ok: true, text: 'Uloženo.' })
    if (!v.id && res.id) router.push(`${baseHref}/${res.id}`)
    else router.refresh()
  })
  const archivovat = () => start(async () => {
    const res = await archivAkce(v.id!, !archiv)
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: archiv ? 'Obnoveno.' : 'Archivováno.' })
    router.refresh()
  })
  const smazat = () => {
    if (!confirm('Smazat akci? Smažou se i její SS vazby, pravidla a rozdělení dokladů, která na ni míří. Platby a doklady samotné zůstanou.')) return
    start(async () => {
      const res = await deleteAkce(v.id!)
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      router.push(baseHref)
    })
  }

  const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>Název
          <input value={v.nazev} onChange={(e) => set('nazev', e.target.value)} className={`${input} w-64`} placeholder="Expedice Šumava 2026" />
        </label>
        <label className={label}>Typ
          <select value={v.typ} onChange={(e) => set('typ', e.target.value as 'akce' | 'grant')} className={input}>
            <option value="akce">akce / výjezd</option>
            <option value="grant">grant</option>
          </select>
        </label>
        <label className={label}>Od
          <input type="date" value={v.datumOd} onChange={(e) => set('datumOd', e.target.value)} className={input} />
        </label>
        <label className={label}>Do
          <input type="date" value={v.datumDo} onChange={(e) => set('datumDo', e.target.value)} className={input} />
        </label>
        <label className={label}>Zakázka v ABRA
          <select value={v.abraZakazka} onChange={(e) => set('abraZakazka', e.target.value)} className={input}>
            <option value="">— bez zakázky —</option>
            {zakazkaOptions.map((z) => <option key={z.kod} value={z.kod}>{z.kod}{z.nazev && z.nazev !== z.kod ? ` — ${z.nazev}` : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className={label}>Rozpočet příjmy (Kč)
          <input value={v.rozpocetPrijmy} onChange={(e) => set('rozpocetPrijmy', e.target.value)} className={`${input} w-32`} />
        </label>
        <label className={label}>Rozpočet náklady (Kč)
          <input value={v.rozpocetNaklady} onChange={(e) => set('rozpocetNaklady', e.target.value)} className={`${input} w-32`} />
        </label>
        <label className={label}>Personální náklady (Kč)
          <input value={v.personalniNaklady} onChange={(e) => set('personalniNaklady', e.target.value)} className={`${input} w-32`} />
        </label>
        <label className={label}>…v měsíci (odečte se z mezd Školy)
          <input type="month" value={v.personalniPeriod} onChange={(e) => set('personalniPeriod', e.target.value)} className={input} />
        </label>
        <label className={label}>Poznámka
          <input value={v.poznamka} onChange={(e) => set('poznamka', e.target.value)} className={`${input} w-56`} />
        </label>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-gray-500 dark:text-stone-400">Platby rodičů (SS kódy pohledávek v Platbách)</div>
        {ssOptions.length === 0 && <p className="text-xs text-gray-400">Žádné pohledávky na akce za poslední rok a půl.</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ssOptions.map((o) => (
            <label key={o.ss} className={`flex items-center gap-1 text-xs ${o.obsazeno && !v.ssKody.includes(o.ss) ? 'text-gray-400' : 'text-gray-700 dark:text-stone-300'}`}>
              <input type="checkbox" checked={v.ssKody.includes(o.ss)} disabled={o.obsazeno && !v.ssKody.includes(o.ss)} onChange={() => toggleSs(o.ss)} />
              {o.popis} <span className="text-gray-400">(SS {o.ss}, {kc(o.predepsano)} Kč{o.obsazeno && !v.ssKody.includes(o.ss) ? ', jiná akce' : ''})</span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={ulozit} disabled={pending} className={primary}>{pending ? '…' : v.id ? 'Uložit akci' : 'Založit akci'}</button>
        {v.id && <button type="button" onClick={archivovat} disabled={pending} className={secondary}>{archiv ? 'Obnovit z archivu' : 'Archivovat'}</button>}
        {v.id && <button type="button" onClick={smazat} disabled={pending} className={`${btn} border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400`}>Smazat</button>}
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
