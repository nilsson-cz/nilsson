import SecondGuardianInvite, { type CoGuardian } from '../_components/SecondGuardianInvite'
import {
  STAV_LABELS, STAV_VARIANT, VEKOVA_KATEGORIE_LABELS, GUARDIAN_ROLE_LABELS,
  type EnrollmentStav, type EnrollmentVekovaKategorie, type GuardianRole,
} from '@/lib/enrollment/types'

// Read-only rekapitulace žádosti + stavový banner. Sdílí vizuální jazyk se
// StepRekap v EnrollmentWizard (Radek/adrText vzor), ale je to samostatná
// (needitovatelná) obrazovka, ne krok wizardu.

interface AppRow {
  id: string
  typ: 'zapis' | 'prestup'
  stav: EnrollmentStav
  dite_jmeno: string
  dite_prijmeni: string
  datum_narozeni: string
  rodne_cislo: string | null
  vekova_kategorie: EnrollmentVekovaKategorie | null
  dite_trvale_bydliste_obec: string
  dite_trvale_bydliste_ulice: string | null
  dite_trvale_bydliste_cislo: string
  dite_trvale_bydliste_psc: string
  dite_bydli_jinde: boolean
  dite_kontaktni_adresa_obec: string | null
  dite_kontaktni_adresa_ulice: string | null
  dite_kontaktni_adresa_cislo: string | null
  dite_kontaktni_adresa_psc: string | null
  soucasna_skola: string | null
  prestup_k_datu: string | null
  created_at: string
}

interface OwnerRow {
  id: string
  first_name: string | null
  last_name: string | null
  telefon: string | null
  pribuzensky_vztah: string | null
  email: string
  address_obec: string | null
  address_ulice: string | null
  address_cislo: string | null
  address_psc: string | null
}

function Radek({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-(--portal-text-subtle)">{label}</span>
      <span className="text-(--portal-text) text-right font-medium">{value || '—'}</span>
    </div>
  )
}

function adr(obec: string | null, ulice: string | null, cislo: string | null, psc: string | null): string {
  if (!obec || !cislo) return '—'
  return `${ulice ? ulice + ' ' : ''}${cislo}, ${psc ?? ''} ${obec}`.trim()
}

const STAV_ZPRAVA: Partial<Record<EnrollmentStav, string>> = {
  dotaznik_odeslan: 'Žádost byla odeslána a čeká na zpracování školou.',
  k_rozhodnuti: 'Žádost zpracovává škola. O rozhodnutí vás budeme informovat.',
  prijat: 'Dítě bylo přijato. Další pokyny k nástupu obdržíte od školy.',
  nepryjat: 'Žádosti nebylo vyhověno. V případě dotazů kontaktujte prosím školu.',
  odklad: 'Byl schválen odklad povinné školní docházky.',
  prestup_zamitnut: 'Žádost o přestup nebyla schválena. V případě dotazů kontaktujte prosím školu.',
  stornovano_rodicem: 'Žádost byla stornována.',
  nedostavili_se: 'K zápisu jste se nedostavili v požadovaném termínu. Kontaktujte prosím školu.',
  autoremedura_zmeneno: 'Rozhodnutí bylo v rámci autoremedury změněno. Kontaktujte prosím školu pro podrobnosti.',
}

export default function StavView({
  app, owner, coGuardians, isOwner,
}: {
  app: AppRow
  owner: OwnerRow | null
  coGuardians: CoGuardian[]
  isOwner: boolean
}) {
  const variant = STAV_VARIANT[app.stav]
  const zprava = STAV_ZPRAVA[app.stav]

  return (
    <div className="max-w-lg mx-auto py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">
          {app.typ === 'zapis' ? 'Žádost o zápis' : 'Žádost o přestup'}
        </h1>
        <p className="mt-1 text-sm text-(--portal-text-muted)">
          {app.dite_jmeno} {app.dite_prijmeni}
        </p>
      </div>

      <div className="portal-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide">Stav žádosti</p>
          <span className={`portal-pill portal-pill-${variant}`}>{STAV_LABELS[app.stav]}</span>
        </div>
        {zprava && (
          <p className="text-sm text-(--portal-text-muted)">{zprava}</p>
        )}
      </div>

      <div className="rounded-lg border border-(--portal-border) divide-y divide-(--portal-border)">
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Dítě</p>
          <Radek label="Jméno" value={`${app.dite_jmeno} ${app.dite_prijmeni}`} />
          <Radek label="Datum narození" value={app.datum_narozeni} />
          <Radek label="Rodné číslo" value={app.rodne_cislo} />
          {app.vekova_kategorie && (
            <Radek label="Věková kategorie" value={VEKOVA_KATEGORIE_LABELS[app.vekova_kategorie]} />
          )}
          <Radek
            label="Trvalé bydliště"
            value={adr(app.dite_trvale_bydliste_obec, app.dite_trvale_bydliste_ulice, app.dite_trvale_bydliste_cislo, app.dite_trvale_bydliste_psc)}
          />
          {app.dite_bydli_jinde && (
            <Radek
              label="Kontaktní adresa"
              value={adr(app.dite_kontaktni_adresa_obec, app.dite_kontaktni_adresa_ulice, app.dite_kontaktni_adresa_cislo, app.dite_kontaktni_adresa_psc)}
            />
          )}
        </div>

        {owner && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Zákonný zástupce</p>
            <Radek label="Jméno" value={`${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim()} />
            <Radek label="Telefon" value={owner.telefon} />
            <Radek label="E-mail" value={owner.email} />
            {owner.pribuzensky_vztah && (
              <Radek
                label="Vztah k dítěti"
                value={GUARDIAN_ROLE_LABELS[owner.pribuzensky_vztah as GuardianRole] ?? owner.pribuzensky_vztah}
              />
            )}
            <Radek label="Adresa" value={adr(owner.address_obec, owner.address_ulice, owner.address_cislo, owner.address_psc)} />
          </div>
        )}

        {app.typ === 'prestup' && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-(--portal-text-subtle) uppercase tracking-wide mb-1">Přestup</p>
            <Radek label="Současná škola" value={app.soucasna_skola} />
            <Radek label="Požadované datum" value={app.prestup_k_datu} />
          </div>
        )}
      </div>

      <div>
        <h2 className="portal-section-title">Druhý zákonný zástupce</h2>
        {isOwner ? (
          <SecondGuardianInvite appId={app.id} coGuardians={coGuardians} />
        ) : coGuardians.length > 0 ? (
          <ul className="space-y-2">
            {coGuardians.map((g) => (
              <li key={g.id} className="flex items-center justify-between rounded-lg border border-(--portal-border) px-4 py-2.5">
                <div className="text-sm">
                  <p className="font-medium text-(--portal-text)">
                    {[g.first_name, g.last_name].filter(Boolean).join(' ') || g.email}
                  </p>
                  <p className="text-xs text-(--portal-text-subtle)">{g.email}</p>
                </div>
                <span className={`portal-pill portal-pill-${g.stav === 'potvrzeno' ? 'success' : 'warn'}`}>
                  {g.stav === 'potvrzeno' ? 'Potvrzeno' : 'Pozván'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-(--portal-text-subtle)">Žádný další zástupce zatím není přizván.</p>
        )}
      </div>
    </div>
  )
}
