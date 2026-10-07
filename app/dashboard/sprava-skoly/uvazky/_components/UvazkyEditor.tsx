'use client'

// Tabulka úvazků v družině k rozhodnému datu: řádek = pracovník × pozice.
// Interní → úvazek (podíl), externí → hodiny v říjnu. Náhled oddílu XIV výkazu
// Z 2-01 se přepočítává živě (oddilXIV). Ukládá se celá sada najednou.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveUvazkySd } from '@/app/actions/uvazky-z201'
import { POZICE_SD, chybaUvazku, oddilXIV, type PoziceSd, type UvazekSd } from '@/lib/uvazky-z201'

export interface Pracovnik {
  id: string
  jmeno: string
  zena: boolean | null   // z RČ; null = neznámé
  externi: boolean       // DPP / DPČ
}

/** Řádek editoru — čísla jako text (desetinná čárka). */
type Radek = Omit<UvazekSd, 'uvazek' | 'hodiny_rijen'> & { uvazek: string; hodiny: string }

const naText = (n: number | null) => (n === null ? '' : String(n).replace('.', ','))
const naCislo = (t: string): number | null => {
  const v = t.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const NAZVY_XIV: { r: keyof ReturnType<typeof oddilXIV>; nazev: string; odsazeni?: boolean }[] = [
  { r: '1401', nazev: 'Vychovatelé' },
  { r: '1402', nazev: 'interní', odsazeni: true },
  { r: '1403', nazev: 'externí', odsazeni: true },
  { r: '1404', nazev: 'Ostatní pedag. pracovníci' },
  { r: '1404a', nazev: 'z toho asistenti pedagoga', odsazeni: true },
  { r: '1405', nazev: 'interní', odsazeni: true },
  { r: '1406', nazev: 'externí', odsazeni: true },
]

export default function UvazkyEditor({
  rdat,
  pocatecni,
  pracovnici,
  hodinyRijna,
  rokRijna,
  zdroj,
  ulozeno,
}: {
  rdat: string
  pocatecni: UvazekSd[]
  pracovnici: Pracovnik[]
  hodinyRijna: number
  rokRijna: number
  zdroj: string
  ulozeno: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [radky, setRadky] = useState<Radek[]>(() =>
    pocatecni.map((u) => ({ ...u, uvazek: naText(u.uvazek), hodiny: naText(u.hodiny_rijen) })))
  const [novy, setNovy] = useState<{ staff: string; pozice: PoziceSd }>({ staff: '', pozice: 'vychovatel_sd' })
  const [zprava, setZprava] = useState<{ ok: boolean; text: string } | null>(
    ulozeno ? null : { ok: false, text: zdroj })

  const jmeno = (id: string) => pracovnici.find((p) => p.id === id)?.jmeno ?? '—'

  const naUvazky = (): UvazekSd[] => radky.map((r) => ({
    staff_id: r.staff_id,
    pozice: r.pozice,
    interni: r.interni,
    uvazek: r.interni ? naCislo(r.uvazek) : null,
    hodiny_rijen: r.interni ? null : naCislo(r.hodiny),
    zena: r.zena,
    nepritomen: r.nepritomen,
    poznamka: r.poznamka,
  }))
  const uvazky = naUvazky()
  const xiv = oddilXIV(uvazky.filter((u) => !chybaUvazku(u)), hodinyRijna)

  const zmen = (i: number, zmena: Partial<Radek>) =>
    setRadky((rs) => rs.map((r, j) => (j === i ? { ...r, ...zmena } : r)))

  function pridat() {
    const p = pracovnici.find((x) => x.id === novy.staff)
    if (!p) return
    if (radky.some((r) => r.staff_id === p.id && r.pozice === novy.pozice)) {
      setZprava({ ok: false, text: `${p.jmeno} už na této pozici v tabulce je.` })
      return
    }
    setRadky((rs) => [...rs, {
      staff_id: p.id, pozice: novy.pozice, interni: !p.externi, uvazek: '', hodiny: '',
      zena: p.zena ?? true, nepritomen: false, poznamka: null,
    }])
    setNovy((n) => ({ ...n, staff: '' }))
    setZprava(null)
  }

  function ulozit() {
    for (const [i, u] of uvazky.entries()) {
      const c = chybaUvazku(u)
      if (c) { setZprava({ ok: false, text: `${jmeno(radky[i].staff_id)}: ${c}` }); return }
    }
    startTransition(async () => {
      const r = await saveUvazkySd(rdat, uvazky)
      if (!r.success) { setZprava({ ok: false, text: r.error }); return }
      setZprava({ ok: true, text: 'Úvazky uloženy.' })
      router.refresh()
    })
  }

  const fmtCislo = (n: number) => n.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {['Pracovník', 'Pozice v družině', 'Vztah', 'Úvazek / hodiny v říjnu', 'Žena', 'Dlouhodobě nepřítomen', ''].map((h) => (
                <th key={h} className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {radky.map((r, i) => (
              <tr key={`${r.staff_id}-${r.pozice}`} className={`border-b border-gray-100 align-top ${r.nepritomen ? 'opacity-60' : ''}`}>
                <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{jmeno(r.staff_id)}</td>
                <td className="px-3 py-2">
                  <select
                    value={r.pozice}
                    onChange={(e) => zmen(i, { pozice: e.target.value as PoziceSd })}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {POZICE_SD.map((p) => <option key={p.kod} value={p.kod}>{p.nazev}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={r.interni ? 'int' : 'ext'}
                    onChange={(e) => zmen(i, { interni: e.target.value === 'int' })}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="int">interní (prac. poměr)</option>
                    <option value="ext">externí (dohoda)</option>
                  </select>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.interni ? (
                    <input
                      type="text" inputMode="decimal" value={r.uvazek} placeholder="např. 0,6"
                      onChange={(e) => zmen(i, { uvazek: e.target.value })}
                      className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="text" inputMode="decimal" value={r.hodiny} placeholder="hodiny"
                        onChange={(e) => zmen(i, { hodiny: e.target.value })}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
                      />
                      <span className="text-xs text-gray-400">h</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={r.zena} onChange={(e) => zmen(i, { zena: e.target.checked })} />
                </td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={r.nepritomen} onChange={(e) => zmen(i, { nepritomen: e.target.checked })} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setRadky((rs) => rs.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    odebrat
                  </button>
                </td>
              </tr>
            ))}
            {radky.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-gray-400">
                  Zatím nikdo — přidejte pracovníky níže.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-3 py-3">
          <label>
            <span className="block text-xs text-gray-500 mb-1">Přidat pracovníka</span>
            <select
              value={novy.staff}
              onChange={(e) => setNovy((n) => ({ ...n, staff: e.target.value }))}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">— vyberte —</option>
              {pracovnici.map((p) => <option key={p.id} value={p.id}>{p.jmeno}</option>)}
            </select>
          </label>
          <select
            value={novy.pozice}
            onChange={(e) => setNovy((n) => ({ ...n, pozice: e.target.value as PoziceSd }))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {POZICE_SD.map((p) => <option key={p.kod} value={p.kod}>{p.nazev}</option>)}
          </select>
          <button
            type="button" onClick={pridat} disabled={!novy.staff}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Přidat
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button" onClick={ulozit} disabled={isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isPending ? 'Ukládám…' : 'Uložit úvazky'}
        </button>
        {zprava && <span className={`text-sm ${zprava.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{zprava.text}</span>}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-2">
          <h2 className="text-sm font-semibold text-gray-700">Náhled: Z 2-01, oddíl XIV</h2>
          <p className="text-xs text-gray-400">
            Externí přepočet = hodiny za říjen / {hodinyRijna} pracovních hodin října {rokRijna}. Bez dlouhodobě nepřítomných.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500">
              <th className="px-4 py-1 text-left font-medium">Řádek</th>
              <th className="px-4 py-1 text-right font-medium">Fyzické osoby</th>
              <th className="px-4 py-1 text-right font-medium">z toho ženy</th>
              <th className="px-4 py-1 text-right font-medium">Přepočtení</th>
            </tr>
          </thead>
          <tbody>
            {NAZVY_XIV.map(({ r, nazev, odsazeni }) => (
              <tr key={r} className="border-t border-gray-50">
                <td className={`px-4 py-1 ${odsazeni ? 'pl-8 text-gray-500' : 'text-gray-800'}`}>
                  <span className="font-mono text-xs text-gray-400 mr-2">{r}</span>{nazev}
                </td>
                <td className="px-4 py-1 text-right tabular-nums">{xiv[r].fyzicke}</td>
                <td className="px-4 py-1 text-right tabular-nums">{xiv[r].zeny}</td>
                <td className="px-4 py-1 text-right tabular-nums">{fmtCislo(xiv[r].prepocet)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
