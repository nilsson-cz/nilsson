'use client'

// Tlačítko „Ukončit docházku / přestup" na kartě žáka (director-only).
// Flow: formulář (poslední den, důvod, cílová škola + IZO) → NÁHLED kaskády
// (co se smaže/uzavře/stornuje + upozornění na zaplacené budoucí předpisy) →
// po potvrzení volá RPC matrika_withdraw_student → shrnutí.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  previewWithdrawal,
  withdrawStudent,
  type WithdrawPreview,
} from '@/app/actions/matrika-withdraw'

type Phase = 'form' | 'preview' | 'done'

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function WithdrawStudentButton({
  studentId,
  studentName,
}: {
  studentId: string
  studentName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')

  const [lastDay, setLastDay] = useState('')
  const [reason, setReason] = useState('Přestup na jinou školu')
  const [targetSchool, setTargetSchool] = useState('')
  const [targetIzo, setTargetIzo] = useState('')

  const [preview, setPreview] = useState<WithdrawPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const izoTrim = targetIzo.trim()
  const izoInvalid = izoTrim.length > 0 && !/^\d{9}$/.test(izoTrim)
  const looksLikeIco = /^\d{8}$/.test(izoTrim)

  function reset() {
    setPhase('form')
    setLastDay('')
    setReason('Přestup na jinou školu')
    setTargetSchool('')
    setTargetIzo('')
    setPreview(null)
    setError(null)
  }

  function close() {
    setOpen(false)
    // až po zavření resetnout, ať se obsah „nepřepne" během animace zmizení
    setTimeout(reset, 0)
  }

  function handlePreview() {
    setError(null)
    if (!lastDay) {
      setError('Zadejte poslední den docházky.')
      return
    }
    if (izoInvalid) {
      setError('IZO cílové školy musí být 9místné číslo (IZO, ne IČO).')
      return
    }
    startTransition(async () => {
      const res = await previewWithdrawal(studentId, lastDay)
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.preview.alreadyWithdrawn) {
        setError('Žák už má docházku ukončenou.')
        return
      }
      setPreview(res.preview)
      setPhase('preview')
    })
  }

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const res = await withdrawStudent({ studentId, lastDay, reason, targetSchool, targetIzo })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setPhase('done')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
      >
        Ukončit docházku / přestup
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) close()
          }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-base text-gray-900">
                Ukončit docházku — {studentName}
              </h2>
              <button
                onClick={close}
                disabled={pending}
                className="text-gray-400 hover:text-gray-700 text-lg leading-none disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* ---------- FORM ---------- */}
              {phase === 'form' && (
                <>
                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">
                      Poslední den docházky
                    </label>
                    <input
                      type="date"
                      value={lastDay}
                      onChange={(e) => setLastDay(e.target.value)}
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Den, kdy je žák naposledy náš. Vše po tomto dni (obědy, družina, členství
                      v budoucím roce) se uklidí.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Důvod</label>
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="např. Přestup na jinou školu"
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">
                      Cílová škola <span className="text-gray-400">(nepovinné)</span>
                    </label>
                    <input
                      type="text"
                      value={targetSchool}
                      onChange={(e) => setTargetSchool(e.target.value)}
                      placeholder="např. ZŠ a MŠ Bečov, okres Most"
                      className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">
                      IZO cílové školy <span className="text-gray-400">(nepovinné, 9 číslic)</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={targetIzo}
                      onChange={(e) => setTargetIzo(e.target.value)}
                      placeholder="např. 600083683"
                      className={`w-full border rounded px-3 py-1.5 text-sm ${
                        izoInvalid ? 'border-red-300 bg-red-50' : 'border-gray-300'
                      }`}
                    />
                    {izoInvalid && (
                      <p className="text-xs text-red-600 mt-1">
                        {looksLikeIco
                          ? 'To vypadá jako IČO (8 číslic). Zadejte IZO — 9místný identifikátor zařízení.'
                          : 'IZO musí být přesně 9 číslic.'}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* ---------- PREVIEW ---------- */}
              {phase === 'preview' && preview && (
                <>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-medium text-amber-900">
                      Zkontrolujte, co se stane. Akci potvrďte až po kontrole.
                    </p>
                    <p className="text-xs text-amber-800 mt-1">
                      Žák <strong>{preview.studentName}</strong> bude označen jako{' '}
                      <strong>ukončen</strong> k <strong>{formatDate(lastDay)}</strong>. Žák se
                      nemaže — zůstává kompletně v evidenci, jen se přepne stav.
                    </p>
                  </div>

                  <ul className="text-sm text-gray-700 space-y-1.5">
                    <CascadeLine
                      done={preview.educationModeDeleted > 0}
                      label={`Matrika — smazat předčasné záznamy budoucího roku: ${preview.educationModeDeleted}`}
                    />
                    <CascadeLine
                      done={preview.educationModeClosed > 0}
                      label={`Matrika — uzavřít probíhající záznam(y) k ${formatDate(lastDay)}: ${preview.educationModeClosed}`}
                    />
                    <CascadeLine
                      done={preview.groupMembershipsDeleted > 0}
                      label={`Třída — smazat členství budoucího roku: ${preview.groupMembershipsDeleted}`}
                    />
                    <CascadeLine
                      done={preview.druzinaDeleted > 0}
                      label={`Družina — smazat budoucí přihlášky: ${preview.druzinaDeleted}`}
                    />
                    <CascadeLine
                      done={preview.druzinaClosed > 0}
                      label={`Družina — odhlásit probíhající přihlášku k ${formatDate(lastDay)}: ${preview.druzinaClosed}`}
                    />
                    <CascadeLine
                      done={preview.lunchOrdersCancelled > 0}
                      label={`Obědy — stornovat objednávky po posledním dni: ${preview.lunchOrdersCancelled}`}
                    />
                    <li className="flex items-start gap-2 text-gray-500">
                      <span className="text-gray-300 mt-0.5">•</span>
                      <span>Auditní řádek do matriky (student_matrika_changes) pro ČŠI.</span>
                    </li>
                  </ul>

                  {/* Platby — nemažou se, jen upozornění */}
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      Platby (nezasahuje se)
                    </p>
                    {preview.futureObligations.length === 0 ? (
                      <p className="text-sm text-gray-500">Žádné budoucí platební předpisy.</p>
                    ) : (
                      <>
                        <ul className="space-y-1 text-sm">
                          {preview.futureObligations.map((o) => (
                            <li key={o.obligation_id} className="flex items-center justify-between gap-3">
                              <span className="text-gray-700">
                                {o.popis} · {o.school_year}
                              </span>
                              <span className="whitespace-nowrap">
                                {Number(o.amount).toLocaleString('cs-CZ')} Kč{' '}
                                {o.paid ? (
                                  <span className="text-red-600 font-medium">zaplaceno</span>
                                ) : (
                                  <span className="text-gray-400">nezaplaceno</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {preview.paidObligationsTotal > 0 && (
                          <p className="text-xs text-red-700 mt-2">
                            ⚠ Zaplaceno celkem{' '}
                            <strong>{preview.paidObligationsTotal.toLocaleString('cs-CZ')} Kč</strong> na
                            budoucích předpisech. Předpisy ani platby se neruší — případnou vratku řeší
                            škola ručně (bankovní úkon).
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}

              {/* ---------- DONE ---------- */}
              {phase === 'done' && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <p className="text-sm font-medium text-green-900">
                    Docházka žáka {studentName} byla ukončena k {formatDate(lastDay)}.
                  </p>
                  <p className="text-xs text-green-800 mt-1">
                    Kaskáda proběhla, do matriky byl zapsán auditní záznam. Platby zůstaly beze změny.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
              {phase === 'form' && (
                <>
                  <button
                    onClick={close}
                    disabled={pending}
                    className="border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={handlePreview}
                    disabled={pending || !lastDay || izoInvalid}
                    className="bg-gray-900 text-white rounded px-4 py-1.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-40"
                  >
                    {pending ? 'Počítám…' : 'Náhled kaskády →'}
                  </button>
                </>
              )}
              {phase === 'preview' && (
                <>
                  <button
                    onClick={() => {
                      setError(null)
                      setPhase('form')
                    }}
                    disabled={pending}
                    className="border border-gray-300 rounded px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    ← Zpět
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={pending}
                    className="bg-red-600 text-white rounded px-4 py-1.5 text-sm font-medium hover:bg-red-700 disabled:opacity-40"
                  >
                    {pending ? 'Ukončuji…' : 'Potvrdit ukončení'}
                  </button>
                </>
              )}
              {phase === 'done' && (
                <button
                  onClick={close}
                  className="bg-gray-900 text-white rounded px-4 py-1.5 text-sm font-medium hover:bg-gray-800"
                >
                  Zavřít
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CascadeLine({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={`flex items-start gap-2 ${done ? 'text-gray-800' : 'text-gray-400'}`}>
      <span className={`mt-0.5 ${done ? 'text-gray-500' : 'text-gray-300'}`}>•</span>
      <span>{label}</span>
    </li>
  )
}
