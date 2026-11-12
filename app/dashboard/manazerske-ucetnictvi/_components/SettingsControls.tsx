'use client'

// Drobné ovládací prvky stránky Nastavení: synchronizace ABRA, uzavřený rok,
// mapování položek dotace na činnosti, činnosti.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { runAbraSync, saveBalikKategorie, saveCinnost, saveMuNastaveni, saveUctyDaruDotaci, saveVfMapovani } from '@/app/actions/manazerske-ucetnictvi'

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'
const primary = `${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`
const secondary = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: true; error?: string }>, okText = 'Uloženo.') => start(async () => {
    const res = await fn()
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: okText })
    router.refresh()
  })
  const Msg = () => (msg ? <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span> : null)
  return { pending, run, setMsg, Msg }
}

export function SyncButton({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const sync = () => start(async () => {
    const res = await runAbraSync()
    setMsg(res.error
      ? { ok: false, text: res.error }
      : { ok: true, text: `Načteno ${res.radku?.toLocaleString('cs-CZ')} řádků (nových ${res.novych}, změněných ${res.zmenenych}, smazaných ${res.smazanych}).` })
    router.refresh()
  })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={sync} disabled={disabled || pending} className={primary}>
        {pending ? 'Načítám z ABRA…' : 'Načíst z ABRA teď'}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}

export function UctyDaruForm({ darFondy, dotaceUcet }: { darFondy: string[]; dotaceUcet: string }) {
  const [v, setV] = useState({ darFondy: darFondy.join(', '), dotaceUcet })
  const { pending, run, Msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Darové účty — fondy i výnos darů (přírůstek = příjem Dary)
        <input value={v.darFondy} onChange={(e) => setV({ ...v, darFondy: e.target.value })} className={`${input} w-56`} placeholder="911400, 911500, 682100" />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Účet záloh dotace KÚ
        <input value={v.dotaceUcet} onChange={(e) => setV({ ...v, dotaceUcet: e.target.value })} className={`${input} w-24`} placeholder="346" />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveUctyDaruDotaci(v))} className={secondary}>Uložit</button>
      <Msg />
    </div>
  )
}

export function UzavrenyRokForm({ initial }: { initial: number | null }) {
  const [v, setV] = useState(initial === null ? '' : String(initial))
  const { pending, run, Msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Uzavřený účetní rok (už se nesynchronizuje)
        <input value={v} onChange={(e) => setV(e.target.value)} className={`${input} w-24 tabular-nums`} placeholder="např. 2025" />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveMuNastaveni({ abraUzavrenyRok: v }))} className={secondary}>Uložit</button>
      <Msg />
    </div>
  )
}

export function VfMapSelect({
  polozkaId, value, options, kategorie, kategorieOptions,
}: {
  polozkaId: string
  value: string
  options: { value: string; label: string }[]
  kategorie: string
  kategorieOptions: { value: string; label: string }[]
}) {
  const [v, setV] = useState(value)
  const [k, setK] = useState(kategorie)
  const { pending, run, Msg } = useAction()
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select value={v} disabled={pending} className={input}
        onChange={(e) => { setV(e.target.value); run(() => saveVfMapovani(polozkaId, { cinnostId: e.target.value })) }}>
        {!v && <option value="">— Škola (výchozí) —</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select value={k} disabled={pending} className={input}
        onChange={(e) => { setK(e.target.value); run(() => saveVfMapovani(polozkaId, { kategorieId: e.target.value || null })) }}>
        <option value="">Dotace (obecná)</option>
        {kategorieOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Msg />
    </span>
  )
}

export function BalikKategorie({
  balikId, vybrane, options,
}: {
  balikId: string
  vybrane: string[]
  options: { value: string; label: string }[]
}) {
  const [v, setV] = useState(new Set(vybrane))
  const { pending, run, Msg } = useAction()
  const toggle = (id: string) => setV((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1 text-xs text-gray-700 dark:text-stone-300">
            <input type="checkbox" checked={v.has(o.value)} onChange={() => toggle(o.value)} /> {o.label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => saveBalikKategorie(balikId, [...v]))} className={secondary}>Uložit</button>
        <Msg />
      </div>
    </div>
  )
}

export function CinnostRow({ id, nazev, aktivni }: { id: string; nazev: string; aktivni: boolean }) {
  const [v, setV] = useState({ nazev, aktivni })
  const { pending, run, Msg } = useAction()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={v.nazev} onChange={(e) => setV({ ...v, nazev: e.target.value })} className={`${input} w-56`} />
      <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-stone-300">
        <input type="checkbox" checked={v.aktivni} onChange={(e) => setV({ ...v, aktivni: e.target.checked })} /> aktivní
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveCinnost({ id, ...v }))} className={secondary}>Uložit</button>
      <Msg />
    </div>
  )
}

export function NewCinnost() {
  const [v, setV] = useState({ kod: '', nazev: '' })
  const { pending, run, Msg } = useAction()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Kód
        <input value={v.kod} onChange={(e) => setV({ ...v, kod: e.target.value })} className={`${input} w-32`} placeholder="napr_krouzky" />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Název
        <input value={v.nazev} onChange={(e) => setV({ ...v, nazev: e.target.value })} className={`${input} w-56`} placeholder="Kroužky" />
      </label>
      <button type="button" disabled={pending} onClick={() => run(() => saveCinnost(v), 'Činnost přidána.')} className={secondary}>Přidat činnost</button>
      <Msg />
    </div>
  )
}
