'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import AddressField from './AddressField'
import SecondGuardianInvite, { type CoGuardian } from './SecondGuardianInvite'
import {
  saveEnrollmentDite,
  saveEnrollmentDiteAdresa,
  saveEnrollmentOwner,
  submitEnrollmentApplication,
  classifyEnrollmentAge,
  confirmPrilisMlade,
} from '@/app/actions/enrollment'
import {
  ZASTUPCE_ROLE_OPTIONS,
  VEKOVA_KATEGORIE_LABELS,
  type EnrollmentTyp,
  type EnrollmentSpecifickePotreby,
  type ValidovanaAdresa,
  type VekovaKlasifikace,
} from '@/lib/enrollment/types'

// ── Typy vstupních dat z DB ─────────────────────────────────────────────

interface AppData {
  id: string
  typ: EnrollmentTyp
  stav: string
  dite_jmeno: string
  dite_prijmeni: string
  rodne_cislo: string | null
  datum_narozeni: string
  misto_narozeni: string | null
  statni_obcanstvi: string | null
  pohlavi: string | null
  zdravotni_pojistovna: string | null
  lekar: string | null
  melo_odklad: boolean
  zdravotni_omezeni: string | null
  dalsi_informace: string | null
  dosavadni_skola: string | null
  specificke_potreby: EnrollmentSpecifickePotreby
  budouci_rocnik: number | null
  vekova_kategorie: string | null
  vyzaduje_ppp: boolean
  vyzaduje_lekare: boolean
  vyzaduje_specialistu: boolean
  prilis_mlade_potvrzeno: boolean
  // adresa dítěte
  dite_trvale_bydliste_obec: string
  dite_trvale_bydliste_ulice: string | null
  dite_trvale_bydliste_cislo: string
  dite_trvale_bydliste_psc: string
  dite_trvale_bydliste_ruian_kod: string
  dite_bydli_jinde: boolean
  dite_kontaktni_adresa_obec: string | null
  dite_kontaktni_adresa_ulice: string | null
  dite_kontaktni_adresa_cislo: string | null
  dite_kontaktni_adresa_psc: string | null
  dite_kontaktni_adresa_ruian_kod: string | null
  // přestup
  prestup_k_datu: string | null
  soucasna_skola: string | null
  soucasna_trida: string | null
  individualni_vzdelavani: boolean | null
  prestup_doporuceni_stav: string | null
}

interface OwnerData {
  id: string
  first_name: string | null
  last_name: string | null
  telefon: string | null
  pribuzensky_vztah: string | null
  datova_schranka: string | null
  email: string
  address_obec: string | null
  address_ulice: string | null
  address_cislo: string | null
  address_psc: string | null
  address_ruian_kod: string | null
}

// ── Pomocné: rekonstrukce ValidovanaAdresa z DB polí ────────────────────

function adrZDb(
  obec: string | null, ulice: string | null, cislo: string | null,
  psc: string | null, ruian: string | null
): ValidovanaAdresa | null {
  if (!ruian || !obec || !cislo || !psc) return null
  return { obec, ulice: ulice || null, cislo, psc, ruian_kod: ruian, validated_at: '' }
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

// ── Krokový model ───────────────────────────────────────────────────────

type StepId = 'dite' | 'adresa' | 'zdravi' | 'prestup' | 'zastupce' | 'druhy' | 'rekap'

export default function EnrollmentWizard({
  app, owner, coGuardians,
}: {
  app: AppData
  owner: OwnerData
  coGuardians: CoGuardian[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const jePrestup = app.typ === 'prestup'
  const steps: { id: StepId; label: string }[] = [
    { id: 'dite', label: 'Dítě' },
    { id: 'adresa', label: 'Adresa dítěte' },
    { id: 'zdravi', label: 'Zdraví a doplňující' },
    ...(jePrestup ? [{ id: 'prestup' as StepId, label: 'Přestup' }] : []),
    { id: 'zastupce', label: 'Zákonný zástupce' },
    { id: 'druhy', label: 'Druhý zástupce' },
    { id: 'rekap', label: 'Odeslání' },
  ]
  const [stepIdx, setStepIdx] = useState(0)
  const step = steps[stepIdx]

  // ── Lokální stav formuláře ────────────────────────────────────────────
  const [dite, setDite] = useState({
    dite_jmeno: app.dite_jmeno || '',
    dite_prijmeni: app.dite_prijmeni || '',
    rodne_cislo: app.rodne_cislo || '',
    datum_narozeni: app.datum_narozeni && app.datum_narozeni !== '1970-01-01' ? app.datum_narozeni : '',
    misto_narozeni: app.misto_narozeni || '',
    statni_obcanstvi: app.statni_obcanstvi || 'ČR',
    pohlavi: (app.pohlavi as '' | 'muz' | 'zena') || '',
    melo_odklad: app.melo_odklad,
    budouci_rocnik: app.budouci_rocnik ?? (jePrestup ? null : 1),
  })

  const [zdravi, setZdravi] = useState({
    zdravotni_pojistovna: app.zdravotni_pojistovna || '',
    lekar: app.lekar || '',
    zdravotni_omezeni: app.zdravotni_omezeni || '',
    dalsi_informace: app.dalsi_informace || '',
    dosavadni_skola: app.dosavadni_skola || '',
    specificke_potreby: app.specificke_potreby || 'ne',
  })

  const [prestup, setPrestup] = useState({
    prestup_k_datu: app.prestup_k_datu || '',
    soucasna_skola: app.soucasna_skola || '',
    soucasna_trida: app.soucasna_trida || '',
    individualni_vzdelavani: app.individualni_vzdelavani ?? false,
    prestup_doporuceni_stav: (app.prestup_doporuceni_stav as any) || '',
  })

  const [trvale, setTrvale] = useState<ValidovanaAdresa | null>(
    adrZDb(app.dite_trvale_bydliste_obec, app.dite_trvale_bydliste_ulice,
      app.dite_trvale_bydliste_cislo, app.dite_trvale_bydliste_psc,
      app.dite_trvale_bydliste_ruian_kod)
  )
  const [bydliJinde, setBydliJinde] = useState(app.dite_bydli_jinde)
  const [kontaktni, setKontaktni] = useState<ValidovanaAdresa | null>(
    adrZDb(app.dite_kontaktni_adresa_obec, app.dite_kontaktni_adresa_ulice,
      app.dite_kontaktni_adresa_cislo, app.dite_kontaktni_adresa_psc,
      app.dite_kontaktni_adresa_ruian_kod)
  )

  const [ownerForm, setOwnerForm] = useState({
    first_name: owner.first_name || '',
    last_name: owner.last_name || '',
    telefon: owner.telefon || '',
    pribuzensky_vztah: owner.pribuzensky_vztah || '',
    datova_schranka: owner.datova_schranka || '',
  })
  const [ownerAdr, setOwnerAdr] = useState<ValidovanaAdresa | null>(
    adrZDb(owner.address_obec, owner.address_ulice, owner.address_cislo,
      owner.address_psc, owner.address_ruian_kod)
  )

  // ── Živá věková klasifikace (pro sekci Zdraví) ───────────────────────
  const [klas, setKlas] = useState<VekovaKlasifikace | null>(
    app.vekova_kategorie
      ? {
          vekova_kategorie: app.vekova_kategorie as any,
          vyzaduje_ppp: app.vyzaduje_ppp,
          vyzaduje_lekare: app.vyzaduje_lekare,
          vyzaduje_specialistu: app.vyzaduje_specialistu,
          odklad_rezim: null,
        }
      : null
  )
  const [prilisMladePotvrzeno, setPrilisMladePotvrzeno] = useState(app.prilis_mlade_potvrzeno)

  useEffect(() => {
    if (!jePrestup && dite.datum_narozeni) {
      let cancelled = false
      classifyEnrollmentAge({ datum_narozeni: dite.datum_narozeni, melo_odklad: dite.melo_odklad })
        .then((res) => { if (!cancelled && res.success) setKlas(res.data) })
      return () => { cancelled = true }
    }
  }, [dite.datum_narozeni, dite.melo_odklad, jePrestup])

  // ── Uložení aktuálního kroku ─────────────────────────────────────────

  function ulozKrok(next: () => void) {
    setError(null)
    startTransition(async () => {
      let res: { success: boolean; error?: string } = { success: true }

      if (step.id === 'dite') {
        res = await saveEnrollmentDite(app.id, {
          ...dite,
          specificke_potreby: zdravi.specificke_potreby,
        })
      } else if (step.id === 'adresa') {
        if (!trvale) { setError('Ověřte prosím trvalé bydliště dítěte v registru adres.'); return }
        if (bydliJinde && !kontaktni) { setError('Ověřte kontaktní adresu, nebo odškrtněte „dítě bydlí jinde".'); return }
        res = await saveEnrollmentDiteAdresa(app.id, {
          trvale: { obec: trvale.obec, ulice: trvale.ulice, cislo: trvale.cislo, psc: trvale.psc, ruian_kod: trvale.ruian_kod },
          bydli_jinde: bydliJinde,
          kontaktni: bydliJinde && kontaktni
            ? { obec: kontaktni.obec, ulice: kontaktni.ulice, cislo: kontaktni.cislo, psc: kontaktni.psc, ruian_kod: kontaktni.ruian_kod }
            : null,
        })
      } else if (step.id === 'zdravi' || step.id === 'prestup') {
        res = await saveEnrollmentDite(app.id, {
          ...dite,
          zdravotni_pojistovna: zdravi.zdravotni_pojistovna,
          lekar: zdravi.lekar,
          zdravotni_omezeni: zdravi.zdravotni_omezeni,
          dalsi_informace: zdravi.dalsi_informace,
          dosavadni_skola: zdravi.dosavadni_skola,
          specificke_potreby: zdravi.specificke_potreby,
          ...(jePrestup ? {
            prestup_k_datu: prestup.prestup_k_datu || null,
            soucasna_skola: prestup.soucasna_skola,
            soucasna_trida: prestup.soucasna_trida,
            individualni_vzdelavani: prestup.individualni_vzdelavani,
            prestup_doporuceni_stav: prestup.prestup_doporuceni_stav || null,
          } : {}),
        })
      } else if (step.id === 'zastupce') {
        if (!ownerForm.first_name.trim() || !ownerForm.last_name.trim()) {
          setError('Vyplňte jméno a příjmení.'); return
        }
        res = await saveEnrollmentOwner(app.id, {
          ...ownerForm,
          adresa: ownerAdr
            ? { obec: ownerAdr.obec, ulice: ownerAdr.ulice, cislo: ownerAdr.cislo, psc: ownerAdr.psc, ruian_kod: ownerAdr.ruian_kod }
            : null,
        })
      }

      if (!res.success) { setError(res.error ?? 'Uložení selhalo.'); return }
      next()
    })
  }

  function dalsi() { ulozKrok(() => setStepIdx((i) => Math.min(i + 1, steps.length - 1))) }
  function zpet() { setStepIdx((i) => Math.max(i - 1, 0)) }

  function odeslat() {
    setError(null)
    startTransition(async () => {
      const res = await submitEnrollmentApplication(app.id)
      if (res.success) {
        router.push(`/zapis/${app.id}/stav`)
      } else {
        setError(res.error)
      }
    })
  }

  async function potvrditPrilisMlade() {
    const res = await confirmPrilisMlade(app.id)
    if (res.success) setPrilisMladePotvrzeno(true)
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">
          {jePrestup ? 'Žádost o přestup' : 'Žádost o zápis'}
        </h1>
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => i < stepIdx && setStepIdx(i)}
                disabled={i > stepIdx}
                className={`text-xs px-2.5 py-1 rounded-full transition ${
                  i === stepIdx
                    ? 'bg-(--portal-accent) text-white'
                    : i < stepIdx
                      ? 'bg-(--portal-accent-subtle) text-(--portal-accent) hover:opacity-80'
                      : 'bg-(--portal-surface-hover) text-(--portal-text-subtle)'
                }`}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="portal-card p-6 space-y-5">
        {step.id === 'dite' && <StepDite dite={dite} setDite={setDite} jePrestup={jePrestup} />}
        {step.id === 'adresa' && (
          <StepAdresa
            trvale={trvale} setTrvale={setTrvale}
            bydliJinde={bydliJinde} setBydliJinde={setBydliJinde}
            kontaktni={kontaktni} setKontaktni={setKontaktni}
          />
        )}
        {step.id === 'zdravi' && (
          <StepZdravi
            zdravi={zdravi} setZdravi={setZdravi}
            jePrestup={jePrestup} klas={klas}
            prilisMladePotvrzeno={prilisMladePotvrzeno}
            onPotvrditPrilisMlade={potvrditPrilisMlade}
          />
        )}
        {step.id === 'prestup' && <StepPrestup prestup={prestup} setPrestup={setPrestup} />}
        {step.id === 'zastupce' && (
          <StepZastupce
            ownerForm={ownerForm} setOwnerForm={setOwnerForm}
            ownerAdr={ownerAdr} setOwnerAdr={setOwnerAdr}
            email={owner.email}
          />
        )}
        {step.id === 'druhy' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-(--portal-text)">Druhý zákonný zástupce</h2>
              <p className="text-sm text-(--portal-text-muted) mt-1">
                Volitelné. Můžete pozvat druhého zákonného zástupce, aby žádost potvrdil.
                Pokračovat můžete i bez čekání na jeho potvrzení.
              </p>
            </div>
            <SecondGuardianInvite appId={app.id} coGuardians={coGuardians} />
          </div>
        )}
        {step.id === 'rekap' && (
          <StepRekap
            dite={dite} zdravi={zdravi} trvale={trvale} bydliJinde={bydliJinde} kontaktni={kontaktni}
            ownerForm={ownerForm} ownerAdr={ownerAdr} jePrestup={jePrestup} prestup={prestup}
            coGuardians={coGuardians} klas={klas}
            prilisMlade={!jePrestup && klas?.vekova_kategorie === 'prilis_mlade' && !prilisMladePotvrzeno}
          />
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Navigace */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={stepIdx === 0 ? () => router.push('/zapis') : zpet}
          disabled={isPending}
          className="text-sm text-(--portal-text-subtle) hover:text-(--portal-text-muted)"
        >
          ← {stepIdx === 0 ? 'Zpět na přehled' : 'Zpět'}
        </button>

        {step.id === 'rekap' ? (
          <button
            type="button"
            onClick={odeslat}
            disabled={isPending || (!jePrestup && klas?.vekova_kategorie === 'prilis_mlade' && !prilisMladePotvrzeno)}
            className="px-6 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
          >
            {isPending ? 'Odesílám…' : 'Odeslat žádost'}
          </button>
        ) : (
          <button
            type="button"
            onClick={dalsi}
            disabled={isPending}
            className="px-6 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition"
          >
            {isPending ? 'Ukládám…' : 'Uložit a pokračovat'}
          </button>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// KROKY
// ═══════════════════════════════════════════════════════════════════════

function StepDite({ dite, setDite, jePrestup }: any) {
  const set = (k: string, v: any) => setDite((d: any) => ({ ...d, [k]: v }))
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-(--portal-text)">Údaje o dítěti</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Jméno <span className="text-red-500">*</span></label>
          <input type="text" value={dite.dite_jmeno} onChange={(e) => set('dite_jmeno', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Příjmení <span className="text-red-500">*</span></label>
          <input type="text" value={dite.dite_prijmeni} onChange={(e) => set('dite_prijmeni', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Datum narození <span className="text-red-500">*</span></label>
          <input type="date" value={dite.datum_narozeni} onChange={(e) => set('datum_narozeni', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Rodné číslo</label>
          <input type="text" value={dite.rodne_cislo} onChange={(e) => set('rodne_cislo', e.target.value)} placeholder="000000/0000" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Místo narození</label>
          <input type="text" value={dite.misto_narozeni} onChange={(e) => set('misto_narozeni', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Státní občanství</label>
          <input type="text" value={dite.statni_obcanstvi} onChange={(e) => set('statni_obcanstvi', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Pohlaví</label>
          <select value={dite.pohlavi} onChange={(e) => set('pohlavi', e.target.value)} className={inputClass}>
            <option value="">— nevybráno —</option>
            <option value="muz">Chlapec</option>
            <option value="zena">Dívka</option>
          </select>
        </div>
        {jePrestup && (
          <div>
            <label className={labelClass}>Do kterého ročníku</label>
            <input type="number" min={1} max={9} value={dite.budouci_rocnik ?? ''} onChange={(e) => set('budouci_rocnik', e.target.value ? Number(e.target.value) : null)} className={inputClass} />
          </div>
        )}
      </div>
      {!jePrestup && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={dite.melo_odklad} onChange={(e) => set('melo_odklad', e.target.checked)} className="rounded border-gray-300" />
          Dítě mělo loni odklad povinné školní docházky
        </label>
      )}
    </div>
  )
}

function StepAdresa({ trvale, setTrvale, bydliJinde, setBydliJinde, kontaktni, setKontaktni }: any) {
  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-(--portal-text)">Adresa dítěte</h2>
      <AddressField
        label="Trvalé bydliště dítěte"
        hint="Musí být ověřeno proti registru adres (RÚIAN) — je podkladem pro spádovost."
        value={trvale} onChange={setTrvale} required
      />
      <label className="flex items-center gap-2 text-sm text-gray-700 pt-2 border-t border-(--portal-border)">
        <input type="checkbox" checked={bydliJinde} onChange={(e) => setBydliJinde(e.target.checked)} className="rounded border-gray-300" />
        Dítě fakticky bydlí na jiné adrese (kontaktní adresa)
      </label>
      {bydliJinde && (
        <AddressField label="Kontaktní adresa dítěte" value={kontaktni} onChange={setKontaktni} required />
      )}
    </div>
  )
}

function StepZdravi({ zdravi, setZdravi, jePrestup, klas, prilisMladePotvrzeno, onPotvrditPrilisMlade }: any) {
  const set = (k: string, v: any) => setZdravi((z: any) => ({ ...z, [k]: v }))
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-(--portal-text)">Zdraví a doplňující údaje</h2>

      {/* Věková klasifikace */}
      {!jePrestup && klas && (
        <VekovaInfo klas={klas} prilisMladePotvrzeno={prilisMladePotvrzeno} onPotvrdit={onPotvrditPrilisMlade} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Zdravotní pojišťovna</label>
          <input type="text" value={zdravi.zdravotni_pojistovna} onChange={(e) => set('zdravotni_pojistovna', e.target.value)} placeholder="Např. 111 – VZP" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Dětský lékař</label>
          <input type="text" value={zdravi.lekar} onChange={(e) => set('lekar', e.target.value)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Zdravotní omezení / alergie</label>
        <textarea value={zdravi.zdravotni_omezeni} onChange={(e) => set('zdravotni_omezeni', e.target.value)} rows={2} className={`${inputClass} resize-none`} />
      </div>
      <div>
        <label className={labelClass}>Specifické vzdělávací potřeby</label>
        <select value={zdravi.specificke_potreby} onChange={(e) => set('specificke_potreby', e.target.value)} className={inputClass}>
          <option value="ne">Ne</option>
          <option value="ano_mame_podklady">Ano — máme podklady z poradny</option>
          <option value="ano_zatim_nemame">Ano — zatím bez podkladů</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Další informace pro školu</label>
        <textarea value={zdravi.dalsi_informace} onChange={(e) => set('dalsi_informace', e.target.value)} rows={2} className={`${inputClass} resize-none`} />
      </div>
    </div>
  )
}

function VekovaInfo({ klas, prilisMladePotvrzeno, onPotvrdit }: { klas: VekovaKlasifikace; prilisMladePotvrzeno: boolean; onPotvrdit: () => void }) {
  const pozadavky: string[] = []
  if (klas.vyzaduje_ppp) pozadavky.push('doporučení pedagogicko-psychologické poradny (PPP/SPC)')
  if (klas.vyzaduje_lekare) pozadavky.push('doporučení dětského lékaře')
  if (klas.vyzaduje_specialistu) pozadavky.push('doporučení odborného lékaře / klinického psychologa')

  const jePrilisMlade = klas.vekova_kategorie === 'prilis_mlade'

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      jePrilisMlade ? 'border-red-200 bg-red-50' : pozadavky.length ? 'border-amber-200 bg-amber-50' : 'border-(--portal-border) bg-(--portal-surface-hover)'
    }`}>
      <p className="font-medium text-(--portal-text)">
        {VEKOVA_KATEGORIE_LABELS[klas.vekova_kategorie]}
      </p>
      {pozadavky.length > 0 && (
        <>
          <p className="mt-1 text-(--portal-text-muted)">K žádosti bude potřeba doložit:</p>
          <ul className="list-disc pl-5 mt-1 text-(--portal-text-muted)">
            {pozadavky.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="mt-1 text-xs text-(--portal-text-subtle)">
            Dokumenty můžete škole doručit i dodatečně (e-mailem nebo osobně).
          </p>
        </>
      )}
      {jePrilisMlade && (
        <div className="mt-2">
          <p className="text-red-700">
            Dítě je pro tento školní rok pravděpodobně příliš mladé na nástup.
            Pokud přesto chcete žádost podat, potvrďte to a domluvte se se školou.
          </p>
          {!prilisMladePotvrzeno ? (
            <button type="button" onClick={onPotvrdit} className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-800">
              Rozumím, přesto chci pokračovat
            </button>
          ) : (
            <p className="mt-2 text-xs text-red-700">✓ Potvrzeno — můžete pokračovat.</p>
          )}
        </div>
      )}
    </div>
  )
}

function StepPrestup({ prestup, setPrestup }: any) {
  const set = (k: string, v: any) => setPrestup((p: any) => ({ ...p, [k]: v }))
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-(--portal-text)">Údaje k přestupu</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Požadované datum přestupu</label>
          <input type="date" value={prestup.prestup_k_datu} onChange={(e) => set('prestup_k_datu', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Současná třída</label>
          <input type="text" value={prestup.soucasna_trida} onChange={(e) => set('soucasna_trida', e.target.value)} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Současná škola</label>
          <input type="text" value={prestup.soucasna_skola} onChange={(e) => set('soucasna_skola', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Doporučení k přestupu</label>
          <select value={prestup.prestup_doporuceni_stav} onChange={(e) => set('prestup_doporuceni_stav', e.target.value)} className={inputClass}>
            <option value="">— nevybráno —</option>
            <option value="ano">Ano</option>
            <option value="ne">Ne</option>
            <option value="zatim_ne">Zatím ne</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={prestup.individualni_vzdelavani} onChange={(e) => set('individualni_vzdelavani', e.target.checked)} className="rounded border-gray-300" />
        Dítě je / bylo v režimu individuálního vzdělávání
      </label>
    </div>
  )
}

function StepZastupce({ ownerForm, setOwnerForm, ownerAdr, setOwnerAdr, email }: any) {
  const set = (k: string, v: any) => setOwnerForm((o: any) => ({ ...o, [k]: v }))
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-(--portal-text)">Vaše údaje (zákonný zástupce)</h2>
      <div className="rounded-lg bg-(--portal-surface-hover) px-4 py-2.5 text-sm text-(--portal-text-muted)">
        Přihlášeni jako <strong>{email}</strong>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Jméno <span className="text-red-500">*</span></label>
          <input type="text" value={ownerForm.first_name} onChange={(e) => set('first_name', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Příjmení <span className="text-red-500">*</span></label>
          <input type="text" value={ownerForm.last_name} onChange={(e) => set('last_name', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Telefon</label>
          <input type="tel" value={ownerForm.telefon} onChange={(e) => set('telefon', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Vztah k dítěti</label>
          <select value={ownerForm.pribuzensky_vztah} onChange={(e) => set('pribuzensky_vztah', e.target.value)} className={inputClass}>
            <option value="">— nevybráno —</option>
            {ZASTUPCE_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Datová schránka <span className="text-gray-400">(pokud máte)</span></label>
          <input type="text" value={ownerForm.datova_schranka} onChange={(e) => set('datova_schranka', e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="pt-2 border-t border-(--portal-border)">
        <AddressField label="Vaše adresa" hint="Nepovinné, ale pomůže při komunikaci. Musí být ověřená." value={ownerAdr} onChange={setOwnerAdr} />
      </div>
    </div>
  )
}

function Radek({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--portal-text-subtle)">{label}</span>
      <span className="text-(--portal-text) text-right font-medium">{value || '—'}</span>
    </div>
  )
}

function adrText(a: ValidovanaAdresa | null): string {
  if (!a) return '—'
  return `${a.ulice ? a.ulice + ' ' : ''}${a.cislo}, ${a.psc} ${a.obec}`
}

function StepRekap({ dite, zdravi, trvale, bydliJinde, kontaktni, ownerForm, ownerAdr, jePrestup, prestup, coGuardians, prilisMlade }: any) {
  return (
    <div className="space-y-5">
      <h2 className="text-base font-semibold text-(--portal-text)">Rekapitulace a odeslání</h2>
      <p className="text-sm text-(--portal-text-muted)">
        Zkontrolujte prosím údaje. Po odeslání se žádost předá škole ke zpracování
        a už ji nebudete moci upravovat.
      </p>

      <div className="rounded-lg border border-(--portal-border) divide-y divide-(--portal-border)">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Dítě</p>
          <Radek label="Jméno" value={`${dite.dite_jmeno} ${dite.dite_prijmeni}`} />
          <Radek label="Datum narození" value={dite.datum_narozeni} />
          <Radek label="Rodné číslo" value={dite.rodne_cislo} />
          <Radek label="Trvalé bydliště" value={adrText(trvale)} />
          {bydliJinde && <Radek label="Kontaktní adresa" value={adrText(kontaktni)} />}
        </div>
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Zákonný zástupce</p>
          <Radek label="Jméno" value={`${ownerForm.first_name} ${ownerForm.last_name}`} />
          <Radek label="Telefon" value={ownerForm.telefon} />
          <Radek label="Adresa" value={adrText(ownerAdr)} />
        </div>
        {jePrestup && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Přestup</p>
            <Radek label="Současná škola" value={prestup.soucasna_skola} />
            <Radek label="Datum přestupu" value={prestup.prestup_k_datu} />
          </div>
        )}
        {coGuardians.length > 0 && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Druhý zástupce</p>
            {coGuardians.map((g: CoGuardian) => (
              <Radek key={g.id} label={g.email} value={g.stav === 'potvrzeno' ? 'Potvrzeno' : 'Pozván'} />
            ))}
          </div>
        )}
      </div>

      {prilisMlade && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Před odesláním potvrďte v kroku „Zdraví a doplňující", že chcete pokračovat
          i přes nízký věk dítěte.
        </div>
      )}
    </div>
  )
}
