'use client'

import { useState, useTransition } from 'react'
import AddressEditor from './AddressEditor'
import { saveAddress } from '@/app/actions/addresses'
import type { ValidovanaAdresa } from '@/lib/enrollment/types'

export interface EntitaAdresy {
  trvale: ValidovanaAdresa | null
  kontaktni: ValidovanaAdresa | null
}

export interface GuardianAdresy extends EntitaAdresy {
  id: string
  jmeno: string
}

export default function AddressesPanel({
  studentId,
  studentAdresy,
  guardiani,
}: {
  studentId: string
  studentAdresy: EntitaAdresy
  guardiani: GuardianAdresy[]
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [copyErr, setCopyErr] = useState<string | null>(null)
  const [copyPending, startCopy] = useTransition()

  // Zkopíruje trvalé bydliště žáka jako trvalé bydliště všem zástupcům.
  function zkopirovatDoZastupcu() {
    const adr = studentAdresy.trvale
    if (!adr || guardiani.length === 0) return
    setCopyErr(null)
    startCopy(async () => {
      for (const g of guardiani) {
        const res = await saveAddress({ guardianId: g.id, typ: 'trvale', adresa: adr })
        if (!res.success) {
          setCopyErr(`${g.jmeno}: ${res.error}`)
          return
        }
      }
      // Plný reload — editory zástupců mají vlastní stav z initial (useState),
      // po hromadné změně je nejjistější je remountovat.
      window.location.reload()
    })
  }

  const copyLabel =
    guardiani.length === 2
      ? 'Oba rodiče mají stejnou adresu jako dítě'
      : 'Zástupci mají stejnou adresu jako dítě'

  const pocet =
    (studentAdresy.trvale ? 1 : 0) +
    (studentAdresy.kontaktni ? 1 : 0) +
    guardiani.reduce((n, g) => n + (g.trvale ? 1 : 0) + (g.kontaktni ? 1 : 0), 0)

  return (
    // AddressField (reuse z enrollmentu) barví tlačítko „Ověřit" přes
    // --portal-accent; ta žije jen v .portal-layout. Na dashboardu ji proto
    // nastavíme lokálně (na oranžovou, ať ladí s „Uložit").
    <div
      className="rounded-xl border border-gray-200 bg-white"
      style={{ ['--portal-accent' as string]: '#f97316' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => setOtevreno((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
          Adresy <span className="ml-1 font-normal text-gray-400">({pocet})</span>
        </h2>
        <span className="text-sm text-gray-400">{otevreno ? 'Skrýt' : 'Upravit →'}</span>
      </button>

      {otevreno && (
        <div className="space-y-6 border-t border-gray-100 p-5">
          <p className="text-xs text-gray-500">
            Adresy se ověřují proti registru RÚIAN (tvrdý blok). Trvalé bydliště žáka drží i kódy obce/
            okresu pro MŠMT výkaz.
          </p>

          {/* Žák */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Žák</h3>
            <AddressEditor
              studentId={studentId}
              typ="trvale"
              label="Trvalé bydliště"
              initial={studentAdresy.trvale}
            />
            <AddressEditor
              studentId={studentId}
              typ="kontaktni"
              label="Kontaktní adresa"
              hint="Jen pokud se liší od trvalého bydliště."
              initial={studentAdresy.kontaktni}
            />
          </section>

          {/* Zkratka: adresa dítěte → všem zástupcům */}
          {guardiani.length > 0 && (
            <div className="space-y-1">
              <button
                type="button"
                disabled={!studentAdresy.trvale || copyPending}
                onClick={zkopirovatDoZastupcu}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                {copyPending ? 'Kopíruji…' : copyLabel}
              </button>
              {!studentAdresy.trvale && (
                <p className="text-xs text-gray-400">Nejdřív ulož trvalé bydliště žáka.</p>
              )}
              {copyErr && <p className="text-xs text-red-600">{copyErr}</p>}
            </div>
          )}

          {/* Zástupci */}
          {guardiani.map((g) => (
            <section key={g.id} className="space-y-4 border-t border-gray-100 pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {g.jmeno}
              </h3>
              <AddressEditor
                guardianId={g.id}
                typ="trvale"
                label="Trvalé bydliště"
                initial={g.trvale}
              />
              <AddressEditor
                guardianId={g.id}
                typ="kontaktni"
                label="Kontaktní adresa"
                hint="Jen pokud se liší od trvalého bydliště."
                initial={g.kontaktni}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
