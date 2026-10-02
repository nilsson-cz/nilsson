'use client'

import { useEffect, useState } from 'react'
import { navrhniSpadovouSkolu } from '@/app/actions/enrollment'
import SkolaVyhledavani from '@/components/skoly/SkolaVyhledavani'
import type { SpadovaSkola, SpadovaSkolaNavrh, SpadovaSkolaZMapy } from '@/lib/enrollment/types'

// app/zapis/[id]/_components/SpadovaSkolaPicker.tsx
// Spádová škola dítěte u zápisu (migrace 145/146). Po ověření trvalého bydliště
// nabídne školu podle vyhlášky obce (mapa spádovosti NPI ČR). Rodič ji potvrdí,
// vybere jinou základní školu z rejstříku, nebo zvolí „nevím“ (doplní škola).
// Společný obvod = víc nabídnutých škol.

function adresaSkoly(s: SpadovaSkolaZMapy): string {
  return [s.ulice, [s.psc, s.obec].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

export default function SpadovaSkolaPicker({
  ruianKod, value, onChange,
}: {
  ruianKod: string
  value: SpadovaSkola
  onChange: (v: SpadovaSkola) => void
}) {
  // Návrh se drží spolu s adresou, ke které patří — po změně adresy se starý nezobrazí.
  const [nacteno, setNacteno] = useState<{ ruianKod: string; navrh: SpadovaSkolaNavrh } | null>(null)

  useEffect(() => {
    let zruseno = false
    navrhniSpadovouSkolu(ruianKod).then((res) => {
      if (zruseno) return
      setNacteno({ ruianKod, navrh: res.success ? res.data : { stav: 'obec_bez_dat', skoly: [], snapshot: null } })
    })
    return () => { zruseno = true }
  }, [ruianKod])

  const navrh = nacteno?.ruianKod === ruianKod ? nacteno.navrh : null
  const jina = value.zdroj === 'rodic'

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-700">Spádová škola <span className="text-red-500">*</span></p>
        <p className="text-xs text-gray-500 mt-0.5">
          Spádová škola je základní škola, na kterou má dítě podle místa trvalého pobytu přednostní
          nárok. Potřebujeme ji jen proto, abychom jí mohli oznámit, že dítě nastoupí k nám.
        </p>
      </div>

      {!navrh && <p className="text-sm text-gray-500">Hledám spádovou školu…</p>}

      {navrh && (
        <div className="space-y-1.5">
          {navrh.skoly.length === 0 && (
            <p className="text-sm text-gray-600">
              Pro tuto adresu nemáme údaje o spádové škole. Vyberte ji prosím ze seznamu, nebo zvolte „Nevím“.
            </p>
          )}
          {navrh.skoly.length === 1 && (
            <p className="text-sm text-gray-600">Podle vyhlášky obce je spádovou školou pro tuto adresu:</p>
          )}
          {navrh.skoly.length > 1 && (
            <p className="text-sm text-gray-600">
              Adresa patří do společného obvodu více škol. Vyberte tu, která je vaší spádovou školou:
            </p>
          )}

          {navrh.skoly.map((s) => (
            <label key={s.izo} className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <input
                type="radio" name="spadova-skola" className="mt-1"
                checked={value.zdroj === 'mapa' && value.izo === s.izo}
                onChange={() => onChange({ zdroj: 'mapa', izo: s.izo, nazev: s.nazev })}
              />
              <span>
                <span className="font-medium text-gray-900">{s.nazev}</span>
                <span className="block text-xs text-gray-500">{adresaSkoly(s)}</span>
              </span>
            </label>
          ))}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio" name="spadova-skola" checked={jina}
              onChange={() => onChange({ zdroj: 'rodic', izo: '', nazev: '' })}
            />
            {navrh.skoly.length ? 'Naše spádová škola je jiná' : 'Vybrat školu ze seznamu'}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="radio" name="spadova-skola" checked={value.zdroj === 'nevim'}
              onChange={() => onChange({ zdroj: 'nevim', izo: '', nazev: '' })}
            />
            Nevím
          </label>
        </div>
      )}

      {jina && (
        value.izo ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm">
            <div>
              <p className="font-medium text-gray-900">{value.nazev}</p>
              <p className="text-xs text-gray-600">IZO {value.izo}</p>
            </div>
            <button type="button" onClick={() => onChange({ zdroj: 'rodic', izo: '', nazev: '' })} className="text-xs text-indigo-700 underline">
              Změnit
            </button>
          </div>
        ) : (
          <SkolaVyhledavani
            druh="B00"
            onSelect={(s) => onChange({ zdroj: 'rodic', izo: s.izo, nazev: s.nazev })}
            placeholder="Název základní školy nebo obec"
            nenalezenoHint="Zkuste jiná slova, nebo zvolte „Nevím“."
          />
        )
      )}
    </div>
  )
}
