'use client'

// Formuláře režie obědů: výpočet/potvrzení měsíce a založení pololetních pohledávek.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { potvrditRezieMesic, vypocitatRezieMesic, vytvoritPohledavkyRezie } from '@/app/actions/mu-obedy'

const input = 'rounded-lg border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-stone-700 dark:bg-stone-900'
const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40'
const primary = `${btn} bg-gray-900 text-white hover:bg-gray-700 dark:bg-stone-100 dark:text-stone-900`
const secondary = `${btn} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800`

const fmt = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))

export function RezieMesicForm({
  period, potvrzeno, initial,
}: {
  period: string
  potvrzeno: boolean
  initial: { rezieRucne: number | null; prispevekRucne: number | null; poznamka: string | null }
}) {
  const router = useRouter()
  const [v, setV] = useState({ rezieRucne: fmt(initial.rezieRucne), prispevekRucne: fmt(initial.prispevekRucne), poznamka: initial.poznamka ?? '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const vypocitat = () => start(async () => {
    const res = await vypocitatRezieMesic(period, v)
    setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: 'Spočítáno a uloženo.' })
    router.refresh()
  })
  const potvrdit = (value: boolean) => {
    if (value && !confirm('Potvrdit měsíc? Doplatky se započítají do pololetní pohledávky a měsíc už nepůjde přepočítat, dokud ho neodemknete.')) return
    start(async () => {
      const res = await potvrditRezieMesic(period, value)
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: value ? 'Měsíc potvrzen.' : 'Měsíc odemčen.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {!potvrzeno && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
            Režie ručně (Kč)
            <input value={v.rezieRucne} onChange={(e) => setV({ ...v, rezieRucne: e.target.value })} className={`${input} w-28`} placeholder="z ABRA" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
            Příspěvek KÚ ručně (Kč)
            <input value={v.prispevekRucne} onChange={(e) => setV({ ...v, prispevekRucne: e.target.value })} className={`${input} w-28`} placeholder="automaticky" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
            Poznámka (povinná u ruční částky)
            <input value={v.poznamka} onChange={(e) => setV({ ...v, poznamka: e.target.value })} className={`${input} w-72`} placeholder="např. faktura jídelny č. …, avízo KÚ" />
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!potvrzeno && (
          <button type="button" onClick={vypocitat} disabled={pending} className={primary}>
            {pending ? '…' : 'Spočítat a uložit'}
          </button>
        )}
        <button type="button" onClick={() => potvrdit(!potvrzeno)} disabled={pending} className={secondary}>
          {potvrzeno ? 'Odemknout měsíc' : 'Potvrdit měsíc'}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}

export type PololetiRadek = {
  student_id: string
  jmeno: string
  obedu: number
  presne: number
  castka: number
  odesel: boolean
  zalozeno: boolean
}

export function PololetiForm({
  skolniRok, pololeti, radky, vychoziSplatnost, lzeZalozit,
}: {
  skolniRok: string
  pololeti: 1 | 2
  radky: PololetiRadek[]
  vychoziSplatnost: string
  lzeZalozit: boolean
}) {
  const router = useRouter()
  const [due, setDue] = useState(vychoziSplatnost)
  const [vynechat, setVynechat] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const nove = radky.filter((r) => !r.zalozeno && !vynechat.has(r.student_id))
  const suma = nove.reduce((s, r) => s + r.castka, 0)

  const zalozit = () => {
    if (!confirm(`Založit ${nove.length} pohledávek v celkové výši ${suma.toLocaleString('cs-CZ')} Kč se splatností ${due}? Rodičům se e-mail neposílá.`)) return
    start(async () => {
      const res = await vytvoritPohledavkyRezie({ skolniRok, pololeti, dueDate: due, vynechat: [...vynechat] })
      setMsg(res.error ? { ok: false, text: res.error } : { ok: true, text: `Založeno ${res.created} pohledávek (SS ${res.ssKod}).` })
      router.refresh()
    })
  }
  const toggle = (id: string) => setVynechat((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  const th = 'px-2 py-2 text-right text-xs font-medium text-gray-500 dark:text-stone-400 whitespace-nowrap'
  const td = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-stone-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-stone-900/60">
            <tr>
              <th className={`${th} text-left pl-4`}>Zahrnout</th>
              <th className={`${th} text-left`}>Žák</th>
              <th className={th}>Obědů</th>
              <th className={th}>Přesně (Kč)</th>
              <th className={`${th} pr-4`}>Pohledávka (Kč)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-stone-800">
            {radky.map((r) => (
              <tr key={r.student_id} className={vynechat.has(r.student_id) ? 'opacity-50' : ''}>
                <td className="px-4 py-1.5">
                  {r.zalozeno
                    ? <span className="text-xs text-emerald-700 dark:text-emerald-400">založeno</span>
                    : <input type="checkbox" checked={!vynechat.has(r.student_id)} onChange={() => toggle(r.student_id)} disabled={!lzeZalozit} />}
                </td>
                <td className="px-2 py-1.5 text-gray-800 dark:text-stone-200">
                  {r.jmeno}
                  {r.odesel && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">odešel</span>}
                </td>
                <td className={`${td} text-gray-700 dark:text-stone-300`}>{r.obedu}</td>
                <td className={`${td} text-gray-500 dark:text-stone-400`}>{r.presne.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`${td} pr-4 font-medium text-gray-900 dark:text-stone-100`}>{r.castka.toLocaleString('cs-CZ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lzeZalozit && nove.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500 dark:text-stone-400">
            Splatnost
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={input} />
          </label>
          <button type="button" onClick={zalozit} disabled={pending} className={primary}>
            {pending ? '…' : `Založit ${nove.length} pohledávek (${suma.toLocaleString('cs-CZ')} Kč)`}
          </button>
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  )
}
