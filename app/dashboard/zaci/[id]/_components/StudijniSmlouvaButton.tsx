'use client'

import { useState } from 'react'

export default function StudijniSmlouvaButton({
  studentId,
  defaultPocetRocniku,
  defaultSkolniRok,
  defaultSkolne = 4400,
}: {
  studentId: string
  defaultPocetRocniku: number
  defaultSkolniRok: string
  defaultSkolne?: number
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [rocniky, setRocniky] = useState(String(defaultPocetRocniku))
  const [skolniRok, setSkolniRok] = useState(defaultSkolniRok)
  const [skolne, setSkolne] = useState(String(defaultSkolne))

  function stahnout() {
    const q = new URLSearchParams({ rocniky, skolniRok, skolne })
    const a = document.createElement('a')
    a.href = `/dashboard/zaci/${studentId}/studijni-smlouva?${q.toString()}`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setOtevreno(false)
  }

  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm'

  return (
    <>
      <button
        type="button"
        onClick={() => setOtevreno(true)}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Studijní smlouva → PDF
      </button>

      {otevreno && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setOtevreno(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Studijní smlouva</h3>
              <p className="mt-0.5 text-xs text-gray-500">
                Údaje žáka a rodičů se doplní z matriky. Co v systému není (datum narození rodičů,
                datum a podpisy), zůstane jako linka k ručnímu doplnění.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-gray-600">
                Počet ročníků
                <input
                  type="number"
                  min={1}
                  max={9}
                  value={rocniky}
                  onChange={(e) => setRocniky(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="block text-sm text-gray-600">
                Od školního roku
                <input
                  type="text"
                  value={skolniRok}
                  onChange={(e) => setSkolniRok(e.target.value)}
                  placeholder="2026/2027"
                  className={inputCls}
                />
              </label>
            </div>
            <label className="block text-sm text-gray-600">
              Školné (Kč/měsíc)
              <input
                type="number"
                min={0}
                value={skolne}
                onChange={(e) => setSkolne(e.target.value)}
                className={inputCls}
              />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOtevreno(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50"
              >
                Zrušit
              </button>
              <button
                type="button"
                disabled={!skolniRok.trim() || !rocniky.trim()}
                onClick={stahnout}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
              >
                Stáhnout PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
