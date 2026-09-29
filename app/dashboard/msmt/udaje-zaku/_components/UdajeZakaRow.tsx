'use client'

// Řádek „Údaje žáků pro MŠMT": rodné číslo + ručně zadávané kódy matriky
// (ODHL, IZOP, KOD_ZAH). Každé pole se ukládá po opuštění / Enteru, Esc vrací.

import { useState, useTransition, useRef } from 'react'
import { updateRodneCislo, updateMsmtPole, type MsmtPole } from '@/app/actions/students'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'

export interface UdajeZaka {
  id: string
  jmeno: string
  odesel: boolean
  birth_date: string | null
  kod_zaka_msmt: string | null
  birth_number: string | null
  msmt_odhl: string | null
  msmt_izop: string | null
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
        <Pole
          initial={zak.msmt_izop}
          sirka="w-28"
          placeholder="IZO (9 číslic)"
          list="msmt-izop"
          maxLength={9}
          kontrola={(v) => (/^\d{9}$/.test(v) ? { ok: true } : { ok: false, zprava: v ? '9 číslic' : 'chybí' })}
          ulozit={ulozPole('msmt_izop')}
        />
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
