'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ulozitDruzinaPrihlaska,
  odeslatDruzinaPrihlasku,
  stornovatDruzinaPrihlasku,
  nastavitSouhlasDruzinaProvoz,
  type DnyDochazky,
} from '@/app/actions/druzina-prihlasky'
import type { ChildPrihlaska } from '../page'

const DNY: { kod: 'po' | 'ut' | 'st' | 'ct' | 'pa'; label: string }[] = [
  { kod: 'po', label: 'Pondělí' },
  { kod: 'ut', label: 'Úterý' },
  { kod: 'st', label: 'Středa' },
  { kod: 'ct', label: 'Čtvrtek' },
  { kod: 'pa', label: 'Pátek' },
]

const STAV_LABEL: Record<string, { text: string; className: string }> = {
  odeslana:  { text: 'Odesláno — čeká na rozhodnutí ředitele', className: 'bg-amber-50 text-amber-700' },
  prijato:   { text: 'Přijato', className: 'bg-emerald-50 text-emerald-700' },
  zamitnuto: { text: 'Zamítnuto', className: 'bg-red-50 text-red-700' },
}

export default function DruzinaPrihlaskaCard({ item }: { item: ChildPrihlaska }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(item.prihlaska === null)

  const p = item.prihlaska

  const [dnyDochazky, setDnyDochazky] = useState<DnyDochazky>((p?.dny_dochazky as DnyDochazky) ?? [])
  const [odchodSam, setOdchodSam] = useState(p?.odchod_sam ?? false)
  const [odchodSamCas, setOdchodSamCas] = useState('16:00')
  const [odchodDoprovod, setOdchodDoprovod] = useState(p?.odchod_doprovod ?? false)
  const [souhlasUplata, setSouhlasUplata] = useState(p?.souhlas_uplata ?? false)
  const [souhlasRad, setSouhlasRad] = useState(p?.souhlas_vnitrni_rad ?? false)
  const [souhlasGdpr, setSouhlasGdpr] = useState(false)
  const [vyzvedavajici, setVyzvedavajici] = useState<{ jmeno: string; telefon: string }[]>(
    p?.vyzvedavajici.map((v) => ({ jmeno: v.jmeno, telefon: v.telefon })) ?? [{ jmeno: '', telefon: '' }]
  )

  function toggleDen(kod: 'po' | 'ut' | 'st' | 'ct' | 'pa') {
    setDnyDochazky((prev) => (prev.includes(kod) ? prev.filter((d) => d !== kod) : [...prev, kod]))
  }

  function handleUlozitAOdeslat() {
    setError(null)
    if (dnyDochazky.length === 0) return setError('Vyberte alespoň jeden den docházky.')
    if (!souhlasUplata) return setError('Je nutné souhlasit s úplatou za družinu.')
    if (!souhlasRad) return setError('Je nutné souhlasit s vnitřním řádem družiny.')
    if (odchodSam && !odchodSamCas) return setError('Zadejte čas samostatného odchodu.')
    if (odchodDoprovod && vyzvedavajici.every((v) => !v.jmeno.trim() || !v.telefon.trim())) {
      return setError('Uveďte alespoň jednu vyzvedávající osobu.')
    }

    startTransition(async () => {
      const saveResult = await ulozitDruzinaPrihlaska({
        prihlaskaId:     p?.id,
        studentId:       item.student.id,
        dnyDochazky,
        odchodSam,
        odchodSamCas,
        odchodDoprovod,
        souhlasUplata,
        souhlasVnitrniRad: souhlasRad,
        vyzvedavajici,
      })
      if (!saveResult.success) return setError(saveResult.error)

      if (souhlasGdpr) {
        await nastavitSouhlasDruzinaProvoz(item.student.id, 'granted')
      }

      const submitResult = await odeslatDruzinaPrihlasku(saveResult.id)
      if (!submitResult.success) return setError(submitResult.error)

      setEditing(false)
      router.refresh()
    })
  }

  function handleUlozitKoncept() {
    setError(null)
    startTransition(async () => {
      const result = await ulozitDruzinaPrihlaska({
        prihlaskaId:     p?.id,
        studentId:       item.student.id,
        dnyDochazky,
        odchodSam,
        odchodSamCas,
        odchodDoprovod,
        souhlasUplata,
        souhlasVnitrniRad: souhlasRad,
        vyzvedavajici,
      })
      if (!result.success) return setError(result.error)
      router.refresh()
    })
  }

  function handleStorno() {
    if (!p) return
    setError(null)
    startTransition(async () => {
      const result = await stornovatDruzinaPrihlasku(p.id)
      if (!result.success) return setError(result.error)
      router.refresh()
    })
  }

  const stavInfo = p ? STAV_LABEL[p.stav] : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          {item.student.last_name} {item.student.first_name}
        </h2>
        {item.jizPrihlasen && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            Již přihlášen(a) do družiny
          </span>
        )}
        {!item.jizPrihlasen && stavInfo && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${stavInfo.className}`}>{stavInfo.text}</span>
        )}
      </div>

      {item.jizPrihlasen && !editing && (
        <p className="text-xs text-gray-400">
          Přihlášení eviduje škola přímo — pro změny (dny docházky, vyzvedávání) kontaktujte družinu.
        </p>
      )}

      {!item.jizPrihlasen && p && p.stav === 'odeslana' && (
        <button
          onClick={handleStorno}
          disabled={isPending}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Stornovat žádost
        </button>
      )}

      {!item.jizPrihlasen && (!p || p.stav === 'rozpracovana') && editing && (
        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Dny docházky <span className="text-red-500">*</span>
            </label>
            <div className="space-y-1">
              {DNY.map(({ kod, label }) => (
                <label key={kod} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={dnyDochazky.includes(kod)} onChange={() => toggleDen(kod)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Způsob odchodu</label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={odchodSam} onChange={(e) => setOdchodSam(e.target.checked)} />
              Dítě odchází samo
              {odchodSam && (
                <input
                  type="time"
                  value={odchodSamCas}
                  onChange={(e) => setOdchodSamCas(e.target.value)}
                  className="ml-1 border border-gray-300 rounded px-2 py-1 text-xs"
                />
              )}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-1">
              <input type="checkbox" checked={odchodDoprovod} onChange={(e) => setOdchodDoprovod(e.target.checked)} />
              Vyzvedává doprovod (jiná osoba než zákonný zástupce)
            </label>
            {!odchodSam && !odchodDoprovod && (
              <p className="text-xs text-gray-400 italic mt-1">Vyzvednu dítě osobně.</p>
            )}
          </div>

          {odchodDoprovod && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Vyzvedávající osoby</label>
              <div className="space-y-2">
                {vyzvedavajici.map((v, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Jméno"
                      value={v.jmeno}
                      onChange={(e) =>
                        setVyzvedavajici((prev) => prev.map((x, idx) => (idx === i ? { ...x, jmeno: e.target.value } : x)))
                      }
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                    <input
                      type="text"
                      placeholder="Telefon"
                      value={v.telefon}
                      onChange={(e) =>
                        setVyzvedavajici((prev) => prev.map((x, idx) => (idx === i ? { ...x, telefon: e.target.value } : x)))
                      }
                      className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setVyzvedavajici((prev) => [...prev, { jmeno: '', telefon: '' }])}
                  className="text-xs text-emerald-600 hover:text-emerald-700"
                >
                  + přidat osobu
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1.5 pt-1 border-t border-gray-100">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={souhlasUplata} onChange={(e) => setSouhlasUplata(e.target.checked)} className="mt-0.5" />
              <span>Souhlasím s úplatou za školní družinu. <span className="text-red-500">*</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={souhlasRad} onChange={(e) => setSouhlasRad(e.target.checked)} className="mt-0.5" />
              <span>Souhlasím s vnitřním řádem školní družiny. <span className="text-red-500">*</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={souhlasGdpr} onChange={(e) => setSouhlasGdpr(e.target.checked)} className="mt-0.5" />
              <span>Souhlasím s rozšířeným zpracováním údajů pro provoz a akce družiny (nepovinné).</span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleUlozitKoncept}
              disabled={isPending}
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Uložit koncept
            </button>
            <button
              onClick={handleUlozitAOdeslat}
              disabled={isPending}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Odesílám…' : 'Odeslat žádost'}
            </button>
          </div>
        </div>
      )}

      {!item.jizPrihlasen && p && p.stav === 'rozpracovana' && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          Pokračovat v žádosti
        </button>
      )}

      {!item.jizPrihlasen && !p && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
        >
          Založit žádost
        </button>
      )}
    </div>
  )
}
