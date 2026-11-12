'use client'

// Editor rozpočtu: řádek plánu (šablona + roční částka, nebo 12 měsíců ručně),
// přidání řádku a kopie plánu z jiného období.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deletePlanRadek, kopirovatPlanOkno, navrhnoutDotaceZVf, savePlanRadek } from '@/app/actions/mu-plan'
import { rozpocitat, type PlanSablona } from '@/lib/manazerske-ucetnictvi/plan'

const input = 'rounded-md border border-gray-300 px-1.5 py-1 text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-40'
const primary = `${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`
const secondary = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`

const num = (s: string) => {
  const n = Number(s.trim().replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const kc = (n: number) => Math.round(n).toLocaleString('cs-CZ')
const fmt = (n: number) => (n === 0 ? '' : String(n).replace('.', ','))

export function PlanRadek({
  okno, mesice, cinnostId, kategorieId, label, typ, initial, skutecnost,
}: {
  okno: string
  mesice: string[]
  cinnostId: string
  kategorieId: string
  label: string
  typ: 'prijem' | 'naklad'
  initial: { sablona: PlanSablona; rocni: number; hodnoty: number[] }
  skutecnost: number | null
}) {
  const router = useRouter()
  const [sablona, setSablona] = useState<PlanSablona>(initial.sablona)
  const [rocni, setRocni] = useState(fmt(initial.rocni))
  const [mesicne, setMesicne] = useState(initial.hodnoty.map(fmt))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const hodnoty = useMemo(
    () => (sablona === 'rucne' ? mesicne.map(num) : rozpocitat(num(rocni), mesice, sablona)),
    [sablona, rocni, mesicne, mesice],
  )
  const suma = hodnoty.reduce((s, v) => s + v, 0)

  const zmenitSablonu = (s: PlanSablona) => {
    if (s === 'rucne') setMesicne(hodnoty.map(fmt))
    else setRocni(fmt(Math.round(suma * 100) / 100))
    setSablona(s)
  }
  const ulozit = () => start(async () => {
    const res = await savePlanRadek({ okno, cinnostId, kategorieId, sablona, rocni, mesicne })
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: 'Uloženo' })
    router.refresh()
  })
  const smazat = () => {
    if (!confirm(`Smazat plán „${label}" v tomto období?`)) return
    start(async () => {
      const res = await deletePlanRadek({ okno, cinnostId, kategorieId })
      if (res.error) setMsg({ ok: false, text: res.error })
      router.refresh()
    })
  }

  return (
    <tr className="align-top">
      <td className="px-3 py-1.5 whitespace-nowrap text-gray-800 dark:text-stone-200">
        <span className={`mr-1.5 text-[10px] uppercase ${typ === 'prijem' ? 'text-emerald-600' : 'text-gray-400'}`}>{typ === 'prijem' ? 'příjem' : 'náklad'}</span>
        {label}
        <div className="mt-1 flex items-center gap-1">
          <select value={sablona} onChange={(e) => zmenitSablonu(e.target.value as PlanSablona)} className={`${input} text-xs`}>
            <option value="12">12 měsíců</option>
            <option value="10">září–červen</option>
            <option value="rucne">ručně</option>
          </select>
          {sablona !== 'rucne' && (
            <input value={rocni} onChange={(e) => setRocni(e.target.value)} placeholder="ročně Kč" className={`${input} w-24 text-xs`} />
          )}
        </div>
      </td>
      {mesice.map((p, i) => (
        <td key={p} className="px-0.5 py-1.5">
          {sablona === 'rucne'
            ? <input value={mesicne[i]} onChange={(e) => setMesicne((m) => m.map((v, j) => (j === i ? e.target.value : v)))} className={`${input} w-16 text-right text-xs`} />
            : <span className="block w-16 px-1.5 py-1 text-right text-xs tabular-nums text-gray-500 dark:text-stone-400">{hodnoty[i] ? kc(hodnoty[i]) : '—'}</span>}
        </td>
      ))}
      <td className="px-2 py-1.5 text-right text-sm font-medium tabular-nums text-gray-900 dark:text-stone-100 whitespace-nowrap">
        {kc(suma)}
        {skutecnost !== null && (
          <div className="text-[10px] font-normal text-gray-500 dark:text-stone-400">skut. {kc(skutecnost)}</div>
        )}
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <div className="flex gap-1">
          <button type="button" onClick={ulozit} disabled={pending} className={primary}>{pending ? '…' : 'Uložit'}</button>
          <button type="button" onClick={smazat} disabled={pending} className={secondary} title="Smazat řádek">✕</button>
        </div>
        {msg && <div className={`mt-0.5 text-[10px] ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</div>}
      </td>
    </tr>
  )
}

/** Výběr kategorie pro nový řádek; přidá ho do URL (?pridat=), řádek se uloží až tlačítkem Uložit. */
export function PridatRadek({ options, baseHref }: { options: { value: string; label: string; group: string }[]; baseHref: string }) {
  const router = useRouter()
  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <select defaultValue="" onChange={(e) => e.target.value && router.push(`${baseHref}&pridat=${e.target.value}`)}
      className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900">
      <option value="">+ přidat kategorii…</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

export function NavrhDotaci({ okno }: { okno: string }) {
  const router = useRouter()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const navrhnout = () => {
    if (!confirm(`Navrhnout dotace pro ${okno} z Veřejných financí? Přepíšou se dotační řádky rozpočtu (Škola, Družina, Podpůrná opatření…) v tomto období; ostatní řádky zůstanou.`)) return
    start(async () => {
      const res = await navrhnoutDotaceZVf(okno)
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: `Zapsáno ${res.radku} měsíčních částek, celkem ${res.celkem?.toLocaleString('cs-CZ')} Kč.` })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-stone-300">
      <button type="button" onClick={navrhnout} disabled={pending} className={primary}>{pending ? '…' : 'Navrhnout dotace z Veřejných financí'}</button>
      <span className="text-xs text-gray-500 dark:text-stone-400">do aktuálního měsíce skutečný nárok, dál nárok aktuálního měsíce (počty beze změny)</span>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}

export function KopieForm({ z, doOkno, cilMaData }: { z: string; doOkno: string; cilMaData: boolean }) {
  const router = useRouter()
  const [pct, setPct] = useState('0')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const kopirovat = () => {
    if (cilMaData && !confirm(`Období ${doOkno} už má rozpočet. Přepsat ho kopií z ${z}?`)) return
    start(async () => {
      const res = await kopirovatPlanOkno({ z, do: doOkno, navyseniPct: pct, prepsat: cilMaData })
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: `Zkopírováno ${res.radku} položek.` })
      router.refresh()
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-stone-300">
      Zkopírovat rozpočet z {z} s navýšením
      <input value={pct} onChange={(e) => setPct(e.target.value)} className="w-14 rounded-md border border-gray-300 px-1.5 py-1 text-right text-sm dark:border-stone-700 dark:bg-stone-900" /> %
      <button type="button" onClick={kopirovat} disabled={pending} className={secondary}>{pending ? '…' : 'Zkopírovat'}</button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}
