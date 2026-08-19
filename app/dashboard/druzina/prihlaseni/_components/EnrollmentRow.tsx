'use client'

import { useState, useTransition } from 'react'
import { enrollStudent, unenrollStudent, type DenVTydnu } from '@/app/actions/druzina'

const DNY: { kod: DenVTydnu; label: string }[] = [
  { kod: 'po', label: 'Po' },
  { kod: 'ut', label: 'Út' },
  { kod: 'st', label: 'St' },
  { kod: 'ct', label: 'Čt' },
  { kod: 'pa', label: 'Pá' },
]

type Enrollment = {
  id: string
  date_from: string
  date_to: string | null
  note: string | null
}

type Student = {
  id: string
  first_name: string
  last_name: string
  kod_zaka?: string
  activeEnrollment: Enrollment | null
  enrollmentHistory: Enrollment[]
}

export default function EnrollmentRow({ student }: { student: Student }) {
  const [isPending, startTransition] = useTransition()
  const [showModal, setShowModal] = useState<'enroll' | 'unenroll' | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [dnyDochazky, setDnyDochazky] = useState<DenVTydnu[]>([])
  const [odchodSam, setOdchodSam] = useState(false)
  const [odchodSamCas, setOdchodSamCas] = useState('16:00')
  const [odchodDoprovod, setOdchodDoprovod] = useState(false)
  const [vyzvedavajici, setVyzvedavajici] = useState<{ jmeno: string; telefon: string }[]>([
    { jmeno: '', telefon: '' },
  ])
  const [error, setError] = useState<string | null>(null)

  const isActive = student.activeEnrollment !== null
  const hasHistory = student.enrollmentHistory.length > 0

  function toggleDen(kod: DenVTydnu) {
    setDnyDochazky((prev) => (prev.includes(kod) ? prev.filter((d) => d !== kod) : [...prev, kod]))
  }

  function handleEnroll() {
    setError(null)
    if (dnyDochazky.length === 0) {
      setError('Vyberte alespoň jeden den docházky.')
      return
    }
    if (odchodSam && !odchodSamCas) {
      setError('Zadejte čas samostatného odchodu.')
      return
    }
    startTransition(async () => {
      const result = await enrollStudent({
        studentId:      student.id,
        dateFrom:       date,
        note,
        dnyDochazky,
        odchodSam,
        odchodSamCas,
        odchodDoprovod,
        vyzvedavajici,
      })
      if (result.success) {
        setShowModal(null)
        setNote('')
        setDnyDochazky([])
        setOdchodSam(false)
        setOdchodDoprovod(false)
        setVyzvedavajici([{ jmeno: '', telefon: '' }])
      } else {
        setError(result.error)
      }
    })
  }

  function handleUnenroll() {
    if (!student.activeEnrollment) return
    setError(null)
    startTransition(async () => {
      const result = await unenrollStudent({ enrollmentId: student.activeEnrollment!.id, dateTo: date })
      if (result.success) {
        setShowModal(null)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <>
      <li className="px-5 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-900">
            {student.last_name} {student.first_name}
          </div>
          {student.kod_zaka && (
            <div className="text-xs text-stone-400">{student.kod_zaka}</div>
          )}
          {isActive && student.activeEnrollment && (
            <div className="text-xs text-emerald-600 mt-0.5">
              přihlášen od {new Date(student.activeEnrollment.date_from).toLocaleDateString('cs-CZ')}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasHistory && (
            <button
              onClick={() => setShowHistory(h => !h)}
              className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
              title="Historie zápisů"
            >
              {student.enrollmentHistory.length}×
            </button>
          )}

          {isActive ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Přihlášen
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-500">
              Nepřihlášen
            </span>
          )}

          {isActive ? (
            <button
              onClick={() => { setDate(new Date().toISOString().slice(0, 10)); setShowModal('unenroll') }}
              className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Odhlásit
            </button>
          ) : (
            <button
              onClick={() => { setDate(new Date().toISOString().slice(0, 10)); setShowModal('enroll') }}
              className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              Přihlásit
            </button>
          )}
        </div>
      </li>

      {showHistory && (
        <li className="px-5 pb-3 bg-stone-50">
          <div className="text-xs text-stone-500 font-medium mb-1.5">Historie zápisů</div>
          <ul className="space-y-1">
            {student.enrollmentHistory.map(e => (
              <li key={e.id} className="text-xs text-stone-600 flex gap-2">
                <span>{new Date(e.date_from).toLocaleDateString('cs-CZ')}</span>
                <span className="text-stone-400">—</span>
                <span>{e.date_to ? new Date(e.date_to).toLocaleDateString('cs-CZ') : 'dosud'}</span>
                {e.note && <span className="text-stone-400 italic">{e.note}</span>}
              </li>
            ))}
          </ul>
        </li>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4 my-8">
            <h3 className="text-sm font-semibold text-stone-900">
              {showModal === 'enroll' ? 'Přihlásit do družiny' : 'Odhlásit z družiny'}
              {' — '}
              {student.last_name} {student.first_name}
            </h3>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">
                {showModal === 'enroll' ? 'Datum přihlášení' : 'Datum odhlášení'}
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {showModal === 'enroll' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">
                    Dny docházky <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-1.5">
                    {DNY.map(({ kod, label }) => (
                      <button
                        key={kod}
                        type="button"
                        onClick={() => toggleDen(kod)}
                        className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors
                          ${dnyDochazky.includes(kod)
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1.5">Způsob odchodu</label>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm text-stone-700">
                      <input type="checkbox" checked={odchodSam} onChange={e => setOdchodSam(e.target.checked)} />
                      Odchází sám
                      {odchodSam && (
                        <input
                          type="time"
                          value={odchodSamCas}
                          onChange={e => setOdchodSamCas(e.target.value)}
                          className="ml-1 border border-stone-300 rounded px-2 py-1 text-xs"
                        />
                      )}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-stone-700">
                      <input type="checkbox" checked={odchodDoprovod} onChange={e => setOdchodDoprovod(e.target.checked)} />
                      Vyzvedává doprovod (uveďte osoby níže)
                    </label>
                    {!odchodSam && !odchodDoprovod && (
                      <p className="text-xs text-stone-400 italic">Vyzvedává zákonný zástupce osobně.</p>
                    )}
                  </div>
                </div>

                {odchodDoprovod && (
                  <div>
                    <label className="block text-xs font-medium text-stone-600 mb-1.5">Vyzvedávající osoby</label>
                    <div className="space-y-2">
                      {vyzvedavajici.map((v, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Jméno"
                            value={v.jmeno}
                            onChange={e => setVyzvedavajici(prev => prev.map((x, idx) => idx === i ? { ...x, jmeno: e.target.value } : x))}
                            className="flex-1 border border-stone-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                          <input
                            type="text"
                            placeholder="Telefon"
                            value={v.telefon}
                            onChange={e => setVyzvedavajici(prev => prev.map((x, idx) => idx === i ? { ...x, telefon: e.target.value } : x))}
                            className="w-28 border border-stone-300 rounded-lg px-2 py-1.5 text-xs"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setVyzvedavajici(prev => [...prev, { jmeno: '', telefon: '' }])}
                        className="text-xs text-emerald-600 hover:text-emerald-700"
                      >
                        + přidat osobu
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Poznámka (nepovinná)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Např. přihláška č. 5"
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <p className="text-xs text-stone-400">
                  Po přihlášení bude automaticky vygenerována pohledávka 1000 Kč (splatnost +14 dní)
                  a odeslána notifikace zákonným zástupcům.
                </p>
              </>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowModal(null); setError(null) }}
                disabled={isPending}
                className="flex-1 px-3 py-2 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
              >
                Zrušit
              </button>
              <button
                onClick={showModal === 'enroll' ? handleEnroll : handleUnenroll}
                disabled={isPending || !date}
                className={`flex-1 px-3 py-2 text-sm rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                  ${showModal === 'enroll' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {isPending
                  ? 'Ukládám…'
                  : showModal === 'enroll' ? 'Přihlásit' : 'Odhlásit'
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
