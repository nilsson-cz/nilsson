'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmSecondGuardian } from '@/app/actions/enrollment'
import AddressField from '@/app/zapis/[id]/_components/AddressField'
import type { ValidovanaAdresa } from '@/lib/enrollment/types'

// Potvrzení druhého zákonného zástupce. Vlastník žádosti smí odeslat i bez čekání
// na tohle potvrzení (PRD §5.1 bod 4). Při potvrzení zástupce vyplní svou adresu
// trvalého bydliště (§9 Q1, povinná) + volitelně kontaktní.

export default function ConfirmSecondGuardian({
  guardianId,
  stav,
  appId,
  initialAdresa,
  initialKontaktni,
}: {
  guardianId: string
  stav: 'pozvan' | 'zaregistrovan' | 'potvrzeno'
  appId: string
  initialAdresa: ValidovanaAdresa | null
  initialKontaktni: ValidovanaAdresa | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [localStav, setLocalStav] = useState(stav)
  const [error, setError] = useState<string | null>(null)
  const [adr, setAdr] = useState<ValidovanaAdresa | null>(initialAdresa)
  const [kontaktni, setKontaktni] = useState<ValidovanaAdresa | null>(initialKontaktni)
  const [jinaKontaktni, setJinaKontaktni] = useState<boolean>(!!initialKontaktni)

  const mapAdr = (a: ValidovanaAdresa) => ({
    obec: a.obec, ulice: a.ulice, cislo: a.cislo, psc: a.psc, ruian_kod: a.ruian_kod,
  })

  function potvrdit() {
    setError(null)
    if (!adr) {
      setError('Ověřte prosím adresu svého trvalého bydliště.')
      return
    }
    startTransition(async () => {
      const res = await confirmSecondGuardian(guardianId, {
        adresa: mapAdr(adr),
        adresaKontaktni: kontaktni ? mapAdr(kontaktni) : null,
      })
      if (res.success) {
        setLocalStav('potvrzeno')
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  if (localStav === 'potvrzeno') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        Děkujeme, potvrdili jste svou účast na žádosti. Další průběh (rozhodnutí školy)
        uvidíte i vy — o výsledku vás budeme informovat.
      </div>
    )
  }

  return (
    <div className="portal-card p-5 space-y-3">
      <p className="text-sm text-(--portal-text-muted)">
        Potvrzením souhlasíte s tím, že jste s podáním této žádosti seznámeni jako
        druhý zákonný zástupce dítěte. Vlastník žádosti může pokračovat v jejím
        vyplňování i bez vašeho potvrzení.
      </p>

      <div className="space-y-4 pt-2 border-t border-(--portal-border)">
        <AddressField
          label="Vaše adresa trvalého bydliště"
          hint="Musí být ověřená v registru RÚIAN."
          value={adr}
          onChange={setAdr}
          required
        />
        <label className="flex items-center gap-2 text-sm text-(--portal-text)">
          <input
            type="checkbox"
            checked={jinaKontaktni}
            onChange={(e) => {
              setJinaKontaktni(e.target.checked)
              if (!e.target.checked) setKontaktni(null)
            }}
          />
          Mám jinou kontaktní (doručovací) adresu
        </label>
        {jinaKontaktni && (
          <AddressField
            label="Kontaktní adresa"
            hint="Kam vám má škola doručovat, pokud se liší od trvalého bydliště."
            value={kontaktni}
            onChange={setKontaktni}
            required
          />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={potvrdit}
        disabled={isPending}
        className="w-full px-4 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm
          font-medium hover:opacity-90 disabled:opacity-50 transition"
      >
        {isPending ? 'Potvrzuji…' : 'Potvrdit účast na žádosti'}
      </button>
    </div>
  )
}
