'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addKonkretniBlok } from '@/app/actions/rozvrh'
import {
  TYP_BLOKU_ORDER, TYP_BLOKU_LABEL, POZICE_LABEL,
  type TypBloku, type PoziceNaBloku, type StaffOption,
} from '@/lib/rozvrh-shared'

type ObsEntry = { staff_id: string; pozice_na_bloku: PoziceNaBloku; supluje_za_staff_id: string | null }

export default function AddKonkretniBlokForm({
  groupId,
  schoolYear,
  datum,
  staff,
}: {
  groupId: string
  schoolYear: string
  datum: string
  staff: StaffOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [casOd, setCasOd] = useState('08:00')
  const [casDo, setCasDo] = useState('09:00')
  const [nazev, setNazev] = useState('')
  const [typ, setTyp] = useState<TypBloku>('vyuka')
  const [obsazeni, setObsazeni] = useState<ObsEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  // rozpracovaný řádek obsazení
  const [novyStaff, setNovyStaff] = useState('')
  const [novaPozice, setNovaPozice] = useState<PoziceNaBloku>('vede')
  const [suplujeZa, setSuplujeZa] = useState('')

  const staffMap = new Map(staff.map((s) => [s.id, s]))
  const obsazeniIds = new Set(obsazeni.map((o) => o.staff_id))
  const volniStaff = staff.filter((s) => !obsazeniIds.has(s.id))

  const inputCls =
    'border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-stone-700 dark:bg-stone-900'

  const reset = () => {
    setCasOd('08:00'); setCasDo('09:00'); setNazev(''); setTyp('vyuka')
    setObsazeni([]); setNovyStaff(''); setNovaPozice('vede'); setSuplujeZa(''); setError(null)
  }

  const pridatOsobu = () => {
    if (!novyStaff || obsazeniIds.has(novyStaff)) return
    setObsazeni((prev) => [...prev, {
      staff_id: novyStaff, pozice_na_bloku: novaPozice, supluje_za_staff_id: suplujeZa || null,
    }])
    setNovyStaff(''); setSuplujeZa(''); setNovaPozice('vede')
  }

  const handleSubmit = () => {
    setError(null)
    startTransition(async () => {
      const res = await addKonkretniBlok({
        group_id: groupId,
        school_year: schoolYear,
        datum,
        cas_od: casOd,
        cas_do: casDo,
        nazev,
        typ_bloku: typ,
        obsazeni,
      })
      if (res?.error) { setError(res.error); return }
      reset(); setOpen(false); router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400">
        + Přidat blok
      </button>
    )
  }

  const jmeno = (id: string) => { const s = staffMap.get(id); return s ? `${s.last_name} ${s.first_name}` : 'Neznámý' }

  return (
    <div className="mt-1 rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-gray-700 dark:text-stone-200">Nový blok (jen tento den)</h4>
        <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-xs text-gray-400 hover:text-gray-600">Zavřít</button>
      </div>

      {/* Základ bloku */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-500">Od</span>
          <input type="time" value={casOd} onChange={(e) => setCasOd(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-500">Do</span>
          <input type="time" value={casDo} onChange={(e) => setCasDo(e.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-gray-500">Typ</span>
          <select value={typ} onChange={(e) => setTyp(e.target.value as TypBloku)} className={inputCls}>
            {TYP_BLOKU_ORDER.map((t) => <option key={t} value={t}>{TYP_BLOKU_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[9rem]">
          <span className="text-[11px] font-medium text-gray-500">Název</span>
          <input type="text" value={nazev} onChange={(e) => setNazev(e.target.value)} placeholder="např. Ranní kruh" className={inputCls} />
        </label>
      </div>

      {/* Obsazení rovnou */}
      <div className="space-y-2">
        <span className="text-[11px] font-medium text-gray-500">Obsazení</span>
        {obsazeni.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {obsazeni.map((o) => (
              <span key={o.staff_id} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                {jmeno(o.staff_id)}
                <span className="text-blue-400">· {POZICE_LABEL[o.pozice_na_bloku]}</span>
                {o.supluje_za_staff_id && <span className="text-amber-600">· supl. za {staffMap.get(o.supluje_za_staff_id)?.last_name ?? ''}</span>}
                <button type="button" onClick={() => setObsazeni((prev) => prev.filter((x) => x.staff_id !== o.staff_id))}
                  className="ml-0.5 text-blue-400 hover:text-red-600" aria-label="Odebrat">×</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select value={novyStaff} onChange={(e) => setNovyStaff(e.target.value)} className={inputCls}>
            <option value="">+ přidat osobu…</option>
            {volniStaff.map((s) => <option key={s.id} value={s.id}>{s.last_name} {s.first_name}{s.active ? '' : ' (neaktivní)'}</option>)}
          </select>
          <select value={novaPozice} onChange={(e) => setNovaPozice(e.target.value as PoziceNaBloku)} className={inputCls}>
            <option value="vede">{POZICE_LABEL.vede}</option>
            <option value="asistuje">{POZICE_LABEL.asistuje}</option>
          </select>
          <select value={suplujeZa} onChange={(e) => setSuplujeZa(e.target.value)} className={inputCls} title="Suplování za koho (volitelné)">
            <option value="">bez suplování</option>
            {staff.map((s) => <option key={s.id} value={s.id}>supluje za {s.last_name} {s.first_name}</option>)}
          </select>
          <button type="button" onClick={pridatOsobu} disabled={!novyStaff}
            className="px-2 py-1 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200">
            Přidat osobu
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleSubmit} disabled={pending || !nazev}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? 'Ukládám…' : 'Vytvořit blok'}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false) }} className="text-xs text-gray-400 hover:text-gray-600">Zrušit</button>
      </div>
    </div>
  )
}
