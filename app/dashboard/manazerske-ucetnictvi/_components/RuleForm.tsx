'use client'

/**
 * Formulář pravidla zařazení (nové i úprava) a ručního přeřazení jednoho řádku ABRA.
 * Cíl se kóduje jako 'c:<id>' (činnost), 'a:<id>' (akce) nebo 'x' (vyloučit z přehledu).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteOverride, deletePravidlo, saveOverride, saveOverrideBulk, savePravidlo } from '@/app/actions/manazerske-ucetnictvi'
import { BULK_FORM_ID } from './bulk-form-id'

export type Option = { value: string; label: string; group?: string }

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Option[]; placeholder: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))]
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">{placeholder}</option>
      {groups.map((g) => g
        ? <optgroup key={g} label={g}>{options.filter((o) => o.group === g).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
        : options.filter((o) => !o.group).map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}

export type RuleInitial = {
  id?: string
  ucetPrefix: string
  zakazka: string | null
  stredisko: string | null
  cinnostAbra: string | null
  cil: string
  kategorieId: string | null
  poznamka: string | null
  aktivni: boolean
}

export function RuleForm({
  initial, cilOptions, katOptions, onDone, compact = false,
}: {
  initial: RuleInitial
  cilOptions: Option[]
  katOptions: Option[]
  onDone?: () => void
  compact?: boolean
}) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof RuleInitial>(k: K, val: RuleInitial[K]) => setV((s) => ({ ...s, [k]: val }))

  const save = () => start(async () => {
    const res = await savePravidlo({ ...v })
    if (res.error) { setMsg({ ok: false, text: res.error }); return }
    setMsg({ ok: true, text: 'Uloženo.' })
    router.refresh()
    onDone?.()
  })
  const remove = () => {
    if (!v.id || !confirm('Smazat pravidlo? Dotčené řádky se zařadí podle ostatních pravidel, nebo spadnou do Nezařazených.')) return
    start(async () => {
      const res = await deletePravidlo(v.id!)
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      router.refresh()
      onDone?.()
    })
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${compact ? '' : 'rounded-xl border border-gray-200 p-3 dark:border-stone-700'}`}>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Účet (prefix)
        <input value={v.ucetPrefix} onChange={(e) => set('ucetPrefix', e.target.value)} className={`${input} w-24 tabular-nums`} placeholder="518" />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Zakázka
        <input value={v.zakazka ?? ''} onChange={(e) => set('zakazka', e.target.value)} className={`${input} w-28`} placeholder="libovolná" title="Hvězdička na konci = zakázka začíná textem, např. 33 155 ASISTENT*" />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Středisko
        <input value={v.stredisko ?? ''} onChange={(e) => set('stredisko', e.target.value)} className={`${input} w-24`} placeholder="libovolné" />
      </label>
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Cíl
        <Select value={v.cil} onChange={(x) => set('cil', x)} options={cilOptions} placeholder="— vyberte —" />
      </label>
      {v.cil !== 'x' && (
        <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
          Kategorie
          <Select value={v.kategorieId ?? ''} onChange={(x) => set('kategorieId', x || null)} options={katOptions} placeholder="— vyberte —" />
        </label>
      )}
      <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
        Poznámka
        <input value={v.poznamka ?? ''} onChange={(e) => set('poznamka', e.target.value)} className={`${input} w-40`} />
      </label>
      {v.id && (
        <label className="flex items-center gap-1 pb-1.5 text-xs text-gray-600 dark:text-stone-300">
          <input type="checkbox" checked={v.aktivni} onChange={(e) => set('aktivni', e.target.checked)} /> aktivní
        </label>
      )}
      <button type="button" onClick={save} disabled={pending}
        className={`${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`}>
        {pending ? '…' : v.id ? 'Uložit' : 'Vytvořit pravidlo'}
      </button>
      {v.id && (
        <button type="button" onClick={remove} disabled={pending}
          className={`${btn} border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400`}>
          Smazat
        </button>
      )}
      {msg && <span className={`pb-1.5 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </div>
  )
}

/** Ruční přeřazení jednoho řádku (override). */
export function OverrideForm({
  flexiId, initial, cilOptions, katOptions,
}: {
  flexiId: number
  initial: { cil: string; kategorieId: string | null; period: string | null; poznamka: string } | null
  cilOptions: Option[]
  katOptions: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState(initial ?? { cil: '', kategorieId: null, period: null, poznamka: '' })
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">
        {initial ? 'upravit přeřazení' : 'přeřadit'}
      </button>
    )
  }
  const save = () => start(async () => {
    const res = await saveOverride({ flexiId, ...v })
    if (res.error) { setMsg(res.error); return }
    setOpen(false)
    router.refresh()
  })
  const remove = () => start(async () => {
    const res = await deleteOverride(flexiId)
    if (res.error) { setMsg(res.error); return }
    setOpen(false)
    router.refresh()
  })
  return (
    <div className="mt-1 flex flex-wrap items-end gap-2">
      <Select value={v.cil} onChange={(x) => setV({ ...v, cil: x })} options={cilOptions} placeholder="— cíl —" />
      {v.cil !== 'x' && <Select value={v.kategorieId ?? ''} onChange={(x) => setV({ ...v, kategorieId: x || null })} options={katOptions} placeholder="— kategorie —" />}
      <input type="month" value={v.period ?? ''} onChange={(e) => setV({ ...v, period: e.target.value || null })} className={input} title="Jiný měsíc (volitelně)" />
      <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} placeholder="poznámka (povinná)" className={`${input} w-44`} />
      <button type="button" onClick={save} disabled={pending} className={`${btn} bg-gray-900 text-white dark:bg-stone-100 dark:text-stone-900`}>Uložit</button>
      {initial && <button type="button" onClick={remove} disabled={pending} className={`${btn} border border-gray-300 dark:border-stone-700`}>Zrušit přeřazení</button>}
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">zavřít</button>
      {msg && <span className="text-xs text-red-600">{msg}</span>}
    </div>
  )
}

/**
 * Hromadné přeřazení: zaškrtávátka v řádcích tabulky patří přes atribut `form`
 * k tomuto formuláři, FormData je proto posbírá i mimo něj (name="flexi").
 */
export function BulkOverrideForm({ cilOptions, katOptions, vseLabel = 'vybrat vše' }: { cilOptions: Option[]; katOptions: Option[]; vseLabel?: string }) {
  const router = useRouter()
  const [v, setV] = useState({ cil: '', kategorieId: '', poznamka: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${BULK_FORM_ID}"]`)]
  const toggleAll = (on: boolean) => boxes().forEach((b) => { b.checked = on })

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const flexiIds = new FormData(e.currentTarget).getAll('flexi').map(Number)
    start(async () => {
      const res = await saveOverrideBulk({ flexiIds, cil: v.cil, kategorieId: v.kategorieId || null, poznamka: v.poznamka })
      if (res.error) { setMsg({ ok: false, text: res.error }); return }
      setMsg({ ok: true, text: `Přeřazeno ${res.radku} dokladů.` })
      toggleAll(false)
      router.refresh()
    })
  }

  return (
    <form id={BULK_FORM_ID} onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 p-3 dark:border-stone-700">
      <span className="pb-1.5 text-xs font-medium text-gray-700 dark:text-stone-300">Hromadně přeřadit zaškrtnuté:</span>
      <Select value={v.cil} onChange={(x) => setV({ ...v, cil: x })} options={cilOptions} placeholder="— cíl —" />
      {v.cil !== 'x' && <Select value={v.kategorieId} onChange={(x) => setV({ ...v, kategorieId: x })} options={katOptions} placeholder="— kategorie —" />}
      <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} placeholder="poznámka (povinná)" className={`${input} w-44`} />
      <button type="submit" disabled={pending} className={`${btn} bg-gray-900 text-white dark:bg-stone-100 dark:text-stone-900`}>Přeřadit</button>
      <button type="button" onClick={() => toggleAll(true)} className="pb-1.5 text-xs text-sky-700 underline decoration-dotted underline-offset-2 dark:text-sky-400">{vseLabel}</button>
      <button type="button" onClick={() => toggleAll(false)} className="pb-1.5 text-xs text-gray-500 underline decoration-dotted underline-offset-2">zrušit výběr</button>
      {msg && <span className={`pb-1.5 text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
    </form>
  )
}
