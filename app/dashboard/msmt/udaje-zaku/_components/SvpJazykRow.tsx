'use client'

// Řádek „Soubor „a“ — údaje, které vyplňuje škola": SZ, ZZ, NADANI, ZVJ
// (students.msmt_*, migrace 132). Výběr se ukládá hned, kód SZ po Enteru /
// opuštění pole, Esc vrací. Má-li žák k RDAT doporučení ŠPZ, jsou SZ/ZZ/NADANI
// zamčené — export je bere z ID_ZNEV a posílá 0 (metodika MŠMT 2026).

import { useRef, useState, useTransition } from 'react'
import { updateMsmtSvp, type MsmtSvpPole } from '@/app/actions/students'

export interface SvpJazykZaka {
  id: string
  jmeno: string
  odesel: boolean
  /** Stav PO k rozhodnému datu: doporučení (stupeň), PLPP, nebo nic. */
  po: { druh: 'doporuceni'; pspo: number } | { druh: 'plpp' } | null
  msmt_sz: string
  msmt_zz: string
  msmt_nadani: string
  msmt_zvj: string
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

function useUlozeni(studentId: string, pole: MsmtSvpPole, initial: string) {
  const [hodnota, setHodnota] = useState(initial)
  const [status, setStatus] = useState<Status>('idle')
  const [chyba, setChyba] = useState('')
  const [isPending, startTransition] = useTransition()

  const uloz = (v: string, predchozi: string, poUlozeni?: (ulozeno: string) => void) => {
    startTransition(async () => {
      setStatus('saving')
      const r = await updateMsmtSvp(studentId, pole, v)
      if ('error' in r) {
        setStatus('error'); setChyba(r.error); setHodnota(predchozi)
      } else {
        setHodnota(r.hodnota ?? '')
        poUlozeni?.(r.hodnota ?? '')
        setStatus('saved'); setChyba('')
        setTimeout(() => setStatus('idle'), 2000)
      }
    })
  }
  return { hodnota, setHodnota, status, chyba, isPending, uloz }
}

function ramecek(status: Status, jineNezVychozi: boolean): string {
  return status === 'error' ? 'border-red-400 bg-red-50'
    : status === 'saved' ? 'border-green-400 bg-green-50'
    : jineNezVychozi ? 'border-amber-300 bg-amber-50'
    : 'border-gray-200 bg-white'
}

function Vyber({ studentId, pole, initial, vychozi, moznosti, zamceno }: {
  studentId: string
  pole: MsmtSvpPole
  initial: string
  vychozi: string
  moznosti: { value: string; label: string }[]
  zamceno?: boolean
}) {
  const u = useUlozeni(studentId, pole, initial)
  return (
    <div>
      <select
        value={u.hodnota}
        disabled={u.isPending || zamceno}
        onChange={(e) => { const pred = u.hodnota; u.setHodnota(e.target.value); u.uloz(e.target.value, pred) }}
        className={`px-1.5 py-1 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${ramecek(u.status, u.hodnota !== vychozi)}`}
      >
        {moznosti.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      {u.status === 'error' && <p className="text-xs text-red-500 mt-0.5 max-w-[10rem]">{u.chyba}</p>}
    </div>
  )
}

function KodSz({ studentId, initial, zamceno }: { studentId: string; initial: string; zamceno: boolean }) {
  const u = useUlozeni(studentId, 'msmt_sz', initial)
  const [original, setOriginal] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const platne = /^(0|[0124]{7})$/.test(u.hodnota)

  const potvrd = () => {
    if (u.hodnota === original) return
    u.uloz(u.hodnota, original, setOriginal)
  }

  return (
    <div>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={u.hodnota}
        maxLength={7}
        placeholder="0"
        disabled={u.isPending || zamceno}
        title="0 = bez SVP z odlišného prostředí. Jinak 7 číslic A–G (0 žádné, 1 mírné, 2 významné, 4 zásadní dopady)."
        onChange={(e) => u.setHodnota(e.target.value.replace(/\D/g, ''))}
        onBlur={potvrd}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur() }
          if (e.key === 'Escape') { u.setHodnota(original); ref.current?.blur() }
        }}
        className={`w-24 px-2 py-1 rounded border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 ${
          !platne && u.hodnota ? 'border-red-300 bg-red-50/40' : ramecek(u.status, u.hodnota !== '0')}`}
      />
      {u.status === 'error' && <p className="text-xs text-red-500 mt-0.5 max-w-[12rem]">{u.chyba}</p>}
      {u.status !== 'error' && !platne && u.hodnota && (
        <p className="text-xs text-red-500 mt-0.5 max-w-[12rem]">0, nebo 7 číslic z 0/1/2/4</p>
      )}
    </div>
  )
}

const NE_ANO = [{ value: '0', label: '0 — ne' }, { value: '1', label: '1 — ano' }]

export function SvpJazykRow({ zak }: { zak: SvpJazykZaka }) {
  const sDoporucenim = zak.po?.druh === 'doporuceni'
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors align-top">
      <td className="px-3 py-2 text-sm font-medium text-gray-800 whitespace-nowrap">
        {zak.jmeno}
        {zak.odesel && <span className="ml-1 text-xs font-normal text-gray-400">(odešel/a)</span>}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {zak.po?.druh === 'doporuceni'
          ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-800">doporučení · PO {zak.po.pspo}</span>
          : zak.po?.druh === 'plpp'
          ? <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">PLPP · PO 1</span>
          : <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2"><KodSz studentId={zak.id} initial={zak.msmt_sz} zamceno={sDoporucenim} /></td>
      <td className="px-3 py-2">
        <Vyber studentId={zak.id} pole="msmt_zz" initial={zak.msmt_zz} vychozi="0" moznosti={NE_ANO} zamceno={sDoporucenim} />
      </td>
      <td className="px-3 py-2">
        <Vyber studentId={zak.id} pole="msmt_nadani" initial={zak.msmt_nadani} vychozi="0" moznosti={NE_ANO} zamceno={sDoporucenim} />
      </td>
      <td className="px-3 py-2">
        <Vyber
          studentId={zak.id}
          pole="msmt_zvj"
          initial={zak.msmt_zvj}
          vychozi="1"
          moznosti={[{ value: '1', label: '1 — dostatečná' }, { value: '0', label: '0 — nedostatečná' }]}
        />
      </td>
    </tr>
  )
}
