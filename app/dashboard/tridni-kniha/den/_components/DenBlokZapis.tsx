'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { potvrditBlok, zrusitPotvrzeniBlok, setBlokPriznak, clearBlokPriznak } from '@/app/actions/rozvrh'
import { casHM, TYP_BLOKU_LABEL, type TypBloku } from '@/lib/rozvrh-shared'

export type ZapisObsazeni = { staff_id: string; jmeno: string; zapocitat_ppc: boolean }
export type StaffOption = { id: string; jmeno: string }
export type PriznakTyp = { kod: string; nazev: string; ikona: string | null; ma_osobu: boolean; ma_poznamku: boolean }
export type BlokPriznak = { typ_kod: string; osoba_staff_id: string | null; poznamka: string | null }

/**
 * Zápis jednoho bloku na denní stránce třídnice (Fáze „třídnice po blocích").
 * Předvyplněno z rozvrhu (název, čas, obsazení). Průvodce odškrtne nepřítomné
 * a napíše krátce, co se dělo → potvrdí blok (RPC potvrdit_blok). Zapisovat smí
 * jen obsazený na bloku nebo ředitel (vynucuje DB); ostatní vidí read-only stav.
 *
 * Příznaky bloku (např. Hospitace) se editují nezávisle na potvrzení — ukládají
 * se okamžitě přes RPC nastavit_blok_priznak / zrusit_blok_priznak (viz PriznakyBlok).
 */
export default function DenBlokZapis({
  blokId,
  nazev,
  casOd,
  casDo,
  typBloku,
  obsahDefault,
  obsazeni,
  potvrzeno,
  canWrite,
  priznakTypy,
  priznaky,
  staffOptions,
}: {
  blokId: string
  nazev: string
  casOd: string
  casDo: string
  typBloku: TypBloku
  obsahDefault: string
  obsazeni: ZapisObsazeni[]
  potvrzeno: boolean
  canWrite: boolean
  priznakTypy: PriznakTyp[]
  priznaky: BlokPriznak[]
  staffOptions: StaffOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [obsah, setObsah] = useState(obsahDefault)
  // Výchozí přítomnost = kdo je zap. do PPČ (po korekci) resp. všichni při prvním zápisu.
  const [pritomni, setPritomni] = useState<Set<string>>(
    () => new Set(obsazeni.filter((o) => o.zapocitat_ppc).map((o) => o.staff_id)),
  )
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setPritomni((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })

  const submit = () => {
    setError(null)
    const absent_ids = obsazeni.map((o) => o.staff_id).filter((id) => !pritomni.has(id))
    startTransition(async () => {
      const res = await potvrditBlok({ blok_id: blokId, obsah, absent_ids })
      if (res.error) { setError(res.error); return }
      setEditing(false)
      router.refresh()
    })
  }

  const zrusit = () => {
    setError(null)
    startTransition(async () => {
      const res = await zrusitPotvrzeniBlok(blokId)
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  const header = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="font-medium text-gray-900 dark:text-stone-100">{casHM(casOd)}–{casHM(casDo)}</span>
      <span className="text-gray-700 dark:text-stone-300">{nazev}</span>
      <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-stone-800 dark:text-stone-300">{TYP_BLOKU_LABEL[typBloku]}</span>
      {potvrzeno && <span className="text-xs font-medium text-emerald-600">✓ zapsáno</span>}
    </div>
  )

  const jmenaObsazeni = obsazeni.map((o) => o.jmeno).join(', ') || '— bez obsazení —'

  const priznakyBlok = (
    <PriznakyBlok
      blokId={blokId}
      typy={priznakTypy}
      initial={priznaky}
      staffOptions={staffOptions}
      canWrite={canWrite}
      onChanged={() => router.refresh()}
    />
  )

  // --- Read-only (nesmím psát) ---
  if (!canWrite) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
        {header}
        <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">
          {potvrzeno ? 'Zapsáno.' : 'Zapíše obsazený na bloku:'} <span className="text-gray-600 dark:text-stone-300">{jmenaObsazeni}</span>
        </p>
        {obsahDefault && <p className="mt-2 text-sm text-gray-700 dark:text-stone-300 whitespace-pre-wrap">{obsahDefault}</p>}
        {priznakyBlok}
      </div>
    )
  }

  // --- Potvrzeno, needituju: náhled + akce ---
  if (potvrzeno && !editing) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        {header}
        {obsahDefault
          ? <p className="mt-2 text-sm text-gray-700 dark:text-stone-300 whitespace-pre-wrap">{obsahDefault}</p>
          : <p className="mt-2 text-xs text-gray-400">Bez poznámky.</p>}
        {priznakyBlok}
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => setEditing(true)} disabled={pending}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 dark:text-stone-300">Upravit zápis</button>
          <button type="button" onClick={zrusit} disabled={pending}
            className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50">Zrušit potvrzení</button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    )
  }

  // --- Editace / první zápis ---
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
      {header}

      <fieldset className="mt-3">
        <legend className="text-xs text-gray-500 dark:text-stone-400">Kdo tam byl (odškrtni nepřítomné — vyřadí se z výkazu PPČ)</legend>
        {obsazeni.length === 0 ? (
          <p className="mt-1 text-xs text-amber-600">⚠ Blok nemá obsazení — nejdřív ho doplní ředitel v rozvrhu.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {obsazeni.map((o) => (
              <label key={o.staff_id} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-stone-200">
                <input type="checkbox" checked={pritomni.has(o.staff_id)} onChange={() => toggle(o.staff_id)} className="rounded border-gray-300" />
                {o.jmeno}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="mt-3 block text-xs text-gray-500 dark:text-stone-400">Co se dělo (nepovinné)</label>
      <textarea value={obsah} onChange={(e) => setObsah(e.target.value)} rows={2}
        placeholder="Krátká poznámka do třídnice…"
        className="mt-0.5 w-full rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900" />

      {priznakyBlok}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={submit} disabled={pending}
          className="px-3 py-1 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
          {pending ? 'Ukládám…' : potvrzeno ? 'Uložit změny' : 'Potvrdit a zapsat'}
        </button>
        {(editing || potvrzeno) && (
          <button type="button" onClick={() => { setEditing(false); setError(null); setObsah(obsahDefault) }} disabled={pending}
            className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">Zrušit</button>
        )}
      </div>
    </div>
  )
}

// ── Příznaky bloku (Hospitace…) ─────────────────────────────────────────────
// Editují se nezávisle na potvrzení bloku, ukládají se okamžitě přes RPC.
// Read-only režim (canWrite=false) zobrazí jen štítky.

function PriznakyBlok({
  blokId,
  typy,
  initial,
  staffOptions,
  canWrite,
  onChanged,
}: {
  blokId: string
  typy: PriznakTyp[]
  initial: BlokPriznak[]
  staffOptions: StaffOption[]
  canWrite: boolean
  onChanged: () => void
}) {
  if (typy.length === 0) return null

  const staffName = (id: string | null) =>
    id ? (staffOptions.find((s) => s.id === id)?.jmeno ?? 'Neznámý') : null

  // Read-only: jen štítky za nastavené příznaky.
  if (!canWrite) {
    const set = typy
      .map((t) => ({ t, p: initial.find((p) => p.typ_kod === t.kod) }))
      .filter((x) => x.p)
    if (set.length === 0) return null
    return (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {set.map(({ t, p }) => (
          <span key={t.kod} className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {t.ikona && <span>{t.ikona}</span>}{t.nazev}
            {p!.osoba_staff_id && <span className="font-normal opacity-80">· {staffName(p!.osoba_staff_id)}</span>}
          </span>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-stone-800">
      {typy.map((t) => (
        <PriznakRow
          key={t.kod}
          blokId={blokId}
          typ={t}
          initial={initial.find((p) => p.typ_kod === t.kod) ?? null}
          staffOptions={staffOptions}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function PriznakRow({
  blokId,
  typ,
  initial,
  staffOptions,
  onChanged,
}: {
  blokId: string
  typ: PriznakTyp
  initial: BlokPriznak | null
  staffOptions: StaffOption[]
  onChanged: () => void
}) {
  const [active, setActive] = useState<boolean>(Boolean(initial))
  const [osoba, setOsoba] = useState<string>(initial?.osoba_staff_id ?? '')
  const [poznamka, setPoznamka] = useState<string>(initial?.poznamka ?? '')
  const [pending, startTransition] = useTransition()
  const [stav, setStav] = useState<'' | 'saving' | 'saved' | 'error'>('')
  const [err, setErr] = useState<string | null>(null)

  const save = (osobaVal: string, poznamkaVal: string) => {
    setErr(null); setStav('saving')
    startTransition(async () => {
      const res = await setBlokPriznak({
        blok_id: blokId,
        typ_kod: typ.kod,
        osoba_id: osobaVal || null,
        poznamka: poznamkaVal || null,
      })
      if (res.error) { setErr(res.error); setStav('error'); return }
      setStav('saved')
      onChanged()
    })
  }

  const onToggle = () => {
    if (pending) return
    if (!active) {
      setActive(true)
      save(osoba, poznamka)  // založí příznak (osoba/poznámka lze doplnit)
    } else {
      setActive(false)
      setErr(null); setStav('saving')
      startTransition(async () => {
        const res = await clearBlokPriznak({ blok_id: blokId, typ_kod: typ.kod })
        if (res.error) { setErr(res.error); setStav('error'); setActive(true); return }
        setStav('')
        onChanged()
      })
    }
  }

  return (
    <div>
      <label className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-stone-200">
        <input type="checkbox" checked={active} onChange={onToggle} disabled={pending} className="rounded border-gray-300" />
        {typ.ikona && <span>{typ.ikona}</span>}
        <span className="font-medium">{typ.nazev}</span>
        {stav === 'saving' && <span className="text-xs text-gray-400">ukládám…</span>}
        {stav === 'saved' && <span className="text-xs text-emerald-600">uloženo</span>}
      </label>

      {active && (typ.ma_osobu || typ.ma_poznamku) && (
        <div className="mt-1.5 ml-6 flex flex-col gap-1.5 sm:flex-row sm:items-center">
          {typ.ma_osobu && (
            <select
              value={osoba}
              disabled={pending}
              onChange={(e) => { setOsoba(e.target.value); save(e.target.value, poznamka) }}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="">— kdo hospitoval —</option>
              {staffOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.jmeno}</option>
              ))}
            </select>
          )}
          {typ.ma_poznamku && (
            <input
              type="text"
              value={poznamka}
              disabled={pending}
              onChange={(e) => setPoznamka(e.target.value)}
              onBlur={() => save(osoba, poznamka)}
              placeholder="Poznámka (nepovinné)"
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
          )}
        </div>
      )}
      {err && <p className="ml-6 mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}
