'use client'

// Řádek „Údaje žáků pro MŠMT": rodné číslo + ručně zadávané kódy matriky
// (ODHL, IZOP, KOD_ZAH). Každé pole se ukládá po opuštění / Enteru, Esc vrací.

import { useState, useTransition, useRef } from 'react'
import { updateRodneCislo, updateMsmtPole, type MsmtPole } from '@/app/actions/students'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import SkolaVyhledavani from '@/components/skoly/SkolaVyhledavani'
import type { SkolaZRejstriku } from '@/lib/enrollment/types'

export interface UdajeZaka {
  id: string
  jmeno: string
  odesel: boolean
  birth_date: string | null
  kod_zaka_msmt: string | null
  birth_number: string | null
  msmt_odhl: string | null
  msmt_izop: string | null
  izop_skola: string | null    // název školy k IZOP z rejstříku (null = kód / nenalezeno)
  kod_zahajeni: string | null
  stpr: string | null          // normalizovaný STPR (null = neznámé občanství)
  citizenship: string | null   // text z IS
}

type Status = 'idle' | 'saving' | 'saved' | 'error'

function formatDate(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(day)}. ${Number(m)}. ${y}`
}

/** Jedno editovatelné pole s vlastním stavem ukládání. */
function Pole({
  initial,
  sirka,
  placeholder,
  list,
  maxLength,
  kontrola,
  ulozit,
}: {
  initial: string | null
  sirka: string
  placeholder: string
  list?: string
  maxLength: number
  kontrola: (v: string) => { ok: boolean; zprava?: string }
  ulozit: (v: string) => Promise<{ success: true; hodnota: string | null } | { error: string }>
}) {
  const [original, setOriginal] = useState(initial ?? '')
  const [value, setValue] = useState(initial ?? '')
  const [status, setStatus] = useState<Status>('idle')
  const [chyba, setChyba] = useState('')
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLInputElement>(null)

  const dirty = value !== original
  const k = kontrola(value)

  const save = () => {
    if (!dirty) return
    startTransition(async () => {
      setStatus('saving')
      const r = await ulozit(value)
      if ('error' in r) {
        setStatus('error')
        setChyba(r.error)
      } else {
        setOriginal(r.hodnota ?? '')
        setValue(r.hodnota ?? '')
        setStatus('saved')
        setTimeout(() => setStatus('idle'), 2000)
      }
    })
  }

  const border =
    status === 'error' ? 'border-red-400 bg-red-50'
    : status === 'saved' ? 'border-green-400 bg-green-50'
    : dirty ? 'border-gray-300 bg-white'
    : k.ok ? 'border-green-300 bg-green-50/50'
    : 'border-red-200 bg-red-50/30'

  return (
    <div>
      <input
        ref={ref}
        type="text"
        value={value}
        list={list}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={isPending}
        onChange={(e) => { setValue(e.target.value.toUpperCase()); setStatus('idle'); setChyba('') }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur() }
          if (e.key === 'Escape') { setValue(original); setStatus('idle'); setChyba(''); ref.current?.blur() }
        }}
        className={`${sirka} px-2 py-1 rounded border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 transition-colors ${border}`}
      />
      {(status === 'error' || (!dirty && !k.ok && k.zprava)) && (
        <p className="text-xs text-red-500 mt-0.5 max-w-[12rem]">{status === 'error' ? chyba : k.zprava}</p>
      )}
    </div>
  )
}

/**
 * IZOP: ruční pole + hledání školy v rejstříku. Zaniklá škola se ukládá jako
 * 000000203 (číselník MŠMT), jinak IZO vybrané školy.
 */
function IzopPole({
  zak, ulozit,
}: {
  zak: UdajeZaka
  ulozit: (v: string) => Promise<{ success: true; hodnota: string | null } | { error: string }>
}) {
  const [verze, setVerze] = useState(0)
  const [hodnota, setHodnota] = useState(zak.msmt_izop)
  const [skola, setSkola] = useState(zak.izop_skola)
  const [hledam, setHledam] = useState(false)
  const [chyba, setChyba] = useState('')
  const [isPending, startTransition] = useTransition()

  const vyber = (s: SkolaZRejstriku) => {
    const izo = s.zanikla_k ? '000000203' : s.izo
    startTransition(async () => {
      const r = await ulozit(izo)
      if ('error' in r) { setChyba(r.error); return }
      setHodnota(r.hodnota)
      setSkola(s.zanikla_k ? `${s.nazev} (zaniklá)` : [s.nazev, s.obec].filter(Boolean).join(', '))
      setVerze((v) => v + 1)
      setHledam(false)
      setChyba('')
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-1">
        <Pole
          key={verze}
          initial={hodnota}
          sirka="w-28"
          placeholder="IZO (9 číslic)"
          list="msmt-izop"
          maxLength={9}
          kontrola={(v) => (/^\d{9}$/.test(v) ? { ok: true } : { ok: false, zprava: v ? '9 číslic' : 'chybí' })}
          ulozit={async (v) => {
            const r = await ulozit(v)
            if (!('error' in r)) { setHodnota(r.hodnota); setSkola(null) }
            return r
          }}
        />
        <button
          type="button" onClick={() => setHledam((h) => !h)} disabled={isPending}
          title="Najít školu v rejstříku"
          className="px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-600 hover:bg-gray-100"
        >
          {hledam ? '×' : 'Hledat'}
        </button>
      </div>
      {skola && !hledam && <p className="text-xs text-gray-500 max-w-[14rem] whitespace-normal">{skola}</p>}
      {hledam && (
        <div className="w-72">
          <SkolaVyhledavani
            druh={null} onSelect={vyber} autoFocus
            placeholder="Škola, obec nebo IZO"
            inputClassName="w-full px-2 py-1 rounded border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
      )}
      {chyba && <p className="text-xs text-red-500">{chyba}</p>}
    </div>
  )
}

export function UdajeZakaRow({ zak, dosavadniSkola }: { zak: UdajeZaka; dosavadniSkola?: string | null }) {
  const ulozPole = (pole: MsmtPole) => (v: string) => updateMsmtPole(zak.id, pole, v)

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors align-top">
      <td className="px-3 py-2 text-sm font-medium text-gray-800 whitespace-nowrap">
        {zak.jmeno}
        {zak.odesel && <span className="ml-1 text-xs font-normal text-gray-400">(odešel/a)</span>}
        <p className="text-xs font-normal text-gray-400">nar. {formatDate(zak.birth_date)}</p>
        {dosavadniSkola && (
          <p className="text-xs font-normal text-gray-500 max-w-[14rem] whitespace-normal">dosavadní škola: {dosavadniSkola}</p>
        )}
        {!zak.stpr && (
          <p className="text-xs font-normal text-red-500">občanství „{zak.citizenship}“ — neznámý kód</p>
        )}
      </td>

      <td className="px-3 py-2">
        <Pole
          initial={zak.birth_number}
          sirka="w-32"
          placeholder="RRMMDD/XXXX"
          maxLength={12}
          kontrola={(v) => {
            const r = zkontrolujRodneCislo(v)
            if (r.stav === 'chybi') return { ok: false, zprava: 'chybí' }
            if (r.stav === 'neplatne') return { ok: false, zprava: r.duvod ?? 'neplatné' }
            if (zak.birth_date && r.datumZRc !== zak.birth_date) return { ok: false, zprava: 'nesedí s datem narození' }
            return { ok: true }
          }}
          ulozit={(v) => updateRodneCislo(zak.id, v)}
        />
      </td>

      <td className="px-3 py-2">
        <Pole
          initial={zak.msmt_odhl}
          sirka="w-16"
          placeholder="010"
          list="msmt-odhl"
          maxLength={3}
          kontrola={(v) => (/^[0-9A-Z]{3}$/.test(v) ? { ok: true } : { ok: false, zprava: v ? '3 znaky' : 'chybí' })}
          ulozit={ulozPole('msmt_odhl')}
        />
      </td>

      <td className="px-3 py-2">
        <IzopPole zak={zak} ulozit={ulozPole('msmt_izop')} />
      </td>

      <td className="px-3 py-2">
        <Pole
          initial={zak.kod_zahajeni}
          sirka="w-12"
          placeholder="1"
          list="msmt-kod-zah"
          maxLength={1}
          kontrola={(v) => (/^[0-9A-Z]$/.test(v) ? { ok: true } : { ok: false, zprava: v ? '1 znak' : 'chybí' })}
          ulozit={ulozPole('kod_zahajeni')}
        />
      </td>

      <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
        {zak.kod_zaka_msmt ?? '—'}
      </td>
    </tr>
  )
}
