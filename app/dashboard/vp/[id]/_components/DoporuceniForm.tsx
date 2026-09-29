'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveDoporuceni } from '@/app/actions/vp-doporuceni'
import {
  INDI_LABEL, UVP_LABEL, STAV_LABEL, FPP_LABEL,
  druhLabel, emptyOpatreni, jePoProSouborB, validateDoporuceni,
} from '@/lib/vp-doporuceni-shared'
import type { Doporuceni, PodpurneOpatreni, StavDoporuceni } from '@/lib/vp-doporuceni-shared'

interface Props {
  initial:  Doporuceni
  onClose:  () => void
  upozorneni?: string[]
}

const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400'
const label = 'block text-xs font-medium text-gray-600 mb-1'

export function DoporuceniForm({ initial, onClose, upozorneni = [] }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [d, setD] = useState<Doporuceni>(initial)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof Doporuceni>(key: K, value: Doporuceni[K]) {
    setD((prev) => ({ ...prev, [key]: value }))
  }
  function setPo(i: number, patch: Partial<PodpurneOpatreni>) {
    setD((prev) => ({ ...prev, opatreni: prev.opatreni.map((po, j) => (j === i ? { ...po, ...patch } : po)) }))
  }

  function handleSave() {
    setError(null)
    const chyby = validateDoporuceni(d)
    if (chyby.length) { setError(chyby.join(' ')); return }
    startTransition(async () => {
      const r = await saveDoporuceni(d)
      if (r.success) { onClose(); router.refresh() }
      else setError(r.error)
    })
  }

  const text = (v: string | null) => v ?? ''

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          {d.id ? 'Úprava doporučení' : d.zdroj === 'xml' ? 'Nové doporučení z XML — zkontrolujte a uložte' : 'Nové doporučení'}
        </h3>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Zrušit</button>
      </div>

      {upozorneni.length > 0 && (
        <ul className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 list-disc list-inside">
          {upozorneni.map((u) => <li key={u}>{u}</li>)}
        </ul>
      )}

      {/* Hlavička doporučení */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>IZO poradny</label>
          <input className={input} value={text(d.izo_spz)} inputMode="numeric" maxLength={9}
            onChange={(e) => set('izo_spz', e.target.value)} />
        </div>
        <div>
          <label className={label}>Č. j. doporučení</label>
          <input className={input} value={text(d.cislo_jednaci)} onChange={(e) => set('cislo_jednaci', e.target.value)} />
        </div>
        <div>
          <label className={label}>Datum vydání</label>
          <input type="date" className={input} value={text(d.datum_vydani)} onChange={(e) => set('datum_vydani', e.target.value || null)} />
        </div>
        <div>
          <label className={label}>Platnost od (škola postupuje od)</label>
          <input type="date" className={input} value={d.platnost_od} onChange={(e) => set('platnost_od', e.target.value)} />
        </div>
        <div>
          <label className={label}>Platnost do</label>
          <input type="date" className={input} value={text(d.platnost_do)} onChange={(e) => set('platnost_do', e.target.value || null)} />
        </div>
        <div>
          <label className={label}>Termín kontrolního vyšetření</label>
          <input type="date" className={input} value={text(d.termin_kontroly)} onChange={(e) => set('termin_kontroly', e.target.value || null)} />
        </div>
      </div>

      {/* Údaje pro matriku „a“ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className={label}>Převažující stupeň PO</label>
          <select className={input} value={d.pspo} onChange={(e) => set('pspo', Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}. stupeň</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Identifikátor znevýhodnění</label>
          <input className={`${input} font-mono uppercase`} value={text(d.id_znev)} maxLength={7} placeholder="např. 06T0000"
            onChange={(e) => set('id_znev', e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className={label}>Další znevýhodnění (jen nenulové)</label>
          <input className={`${input} font-mono uppercase`} value={text(d.id_znev_dalsi)} maxLength={6} placeholder="000000"
            onChange={(e) => set('id_znev_dalsi', e.target.value.toUpperCase())} />
        </div>
        <div>
          <label className={label}>IVP</label>
          <select className={input} value={d.indi} onChange={(e) => set('indi', e.target.value as Doporuceni['indi'])}>
            {Object.entries(INDI_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Upravený vzdělávací program</label>
          <select className={input} value={d.uvp} onChange={(e) => set('uvp', e.target.value as Doporuceni['uvp'])}>
            {Object.entries(UVP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Prodloužení vzdělávání (roky)</label>
          <select className={input} value={d.prodl_dv} onChange={(e) => set('prodl_dv', Number(e.target.value))}>
            {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={d.upr_vyst} onChange={(e) => set('upr_vyst', e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400" />
          Upravené očekávané výstupy
        </label>
        <div>
          <label className={label}>Stav</label>
          <select className={input} value={d.stav} onChange={(e) => set('stav', e.target.value as StavDoporuceni)}>
            {Object.entries(STAV_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {d.stav === 'ukonceno' && (
          <div>
            <label className={label}>Ukončeno k</label>
            <input type="date" className={input} value={text(d.ukonceno_k)} onChange={(e) => set('ukonceno_k', e.target.value || null)} />
          </div>
        )}
      </div>

      {/* Podpůrná opatření */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Podpůrná opatření s kódem NFN</h4>
          <button type="button" onClick={() => set('opatreni', [...d.opatreni, emptyOpatreni()])}
            className="text-sm text-orange-600 hover:text-orange-800">+ Přidat opatření</button>
        </div>
        {d.opatreni.length === 0 && <p className="text-sm text-gray-400">Bez opatření s kódem NFN.</p>}
        {d.opatreni.map((po, i) => (
          <div key={po.id ?? `novy-${i}`} className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-800">
                {po.druh ? druhLabel(po.druh) : `Opatření ${i + 1}`}
                {po.kod_nfn && !jePoProSouborB(po) && (
                  <span className="ml-2 text-xs text-gray-500">(pro školské zařízení — do souboru „b“ nejde)</span>
                )}
              </span>
              <button type="button" onClick={() => set('opatreni', d.opatreni.filter((_, j) => j !== i))}
                className="text-xs text-red-600 hover:text-red-800">Odebrat</button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className={label}>Druh</label>
                <input className={input} value={po.druh} placeholder="asistent_pedagoga" onChange={(e) => setPo(i, { druh: e.target.value })} />
              </div>
              <div>
                <label className={label}>Kód NFN</label>
                <input className={`${input} font-mono uppercase`} value={text(po.kod_nfn)} maxLength={9}
                  onChange={(e) => setPo(i, { kod_nfn: e.target.value.toUpperCase() })} />
              </div>
              <div>
                <label className={label}>Stupeň</label>
                <select className={input} value={po.stupen ?? ''} onChange={(e) => setPo(i, { stupen: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>Počet jednotek</label>
                <input className={input} inputMode="decimal" value={po.pocet_jednotek ?? ''}
                  onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); setPo(i, { pocet_jednotek: e.target.value && Number.isFinite(n) ? n : null }) }} />
              </div>
              <div>
                <label className={label}>Zdroj financování</label>
                <select className={input} value={po.zdroj_financovani ?? ''}
                  onChange={(e) => setPo(i, { zdroj_financovani: (e.target.value || null) as PodpurneOpatreni['zdroj_financovani'] })}>
                  <option value="">—</option>
                  <option value="NFN">NFN</option>
                  <option value="PNFN">PNFN</option>
                </select>
              </div>
              <div>
                <label className={label}>Požadujeme finance (FN)</label>
                <select className={input} value={po.fn} onChange={(e) => setPo(i, { fn: e.target.value as PodpurneOpatreni['fn'] })}>
                  <option value="1">ano</option>
                  <option value="0">ne</option>
                </select>
              </div>
              <div>
                <label className={label}>Pomůcka — pořízení</label>
                <select className={input} value={po.fpp ?? ''} onChange={(e) => setPo(i, { fpp: (e.target.value || null) as PodpurneOpatreni['fpp'] })}>
                  <option value="">— (personální PO)</option>
                  {Object.entries(FPP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div />
              <div>
                <label className={label}>Doporučeno od</label>
                <input type="date" className={input} value={text(po.datum_zahajeni)} onChange={(e) => setPo(i, { datum_zahajeni: e.target.value || null })} />
              </div>
              <div>
                <label className={label}>Doporučeno do</label>
                <input type="date" className={input} value={text(po.datum_ukonceni)} onChange={(e) => setPo(i, { datum_ukonceni: e.target.value || null })} />
              </div>
              <div>
                <label className={label}>Skutečně poskytováno od</label>
                <input type="date" className={input} value={text(po.poskytovano_od)} onChange={(e) => setPo(i, { poskytovano_od: e.target.value || null })} />
              </div>
              <div>
                <label className={label}>Skutečně ukončeno</label>
                <input type="date" className={input} value={text(po.poskytovano_do)} onChange={(e) => setPo(i, { poskytovano_do: e.target.value || null })} />
              </div>
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-500">
          „Skutečně poskytováno od“ je datum, kdy škola opatření opravdu zahájila (musí sedět s výkazem R 44-99).
          Opatření bez tohoto data se do souboru „b“ nevykazuje.
        </p>
      </div>

      <div>
        <label className={label}>Poznámka</label>
        <textarea className={`${input} resize-none`} rows={2} value={text(d.poznamka)} onChange={(e) => set('poznamka', e.target.value)} />
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-orange-100 pt-3">
        <button type="button" onClick={onClose} disabled={isPending}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50">Zrušit</button>
        <button type="button" onClick={handleSave} disabled={isPending}
          className="rounded-lg bg-orange-500 px-5 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
          {isPending ? 'Ukládám…' : 'Uložit doporučení'}
        </button>
      </div>
    </div>
  )
}
