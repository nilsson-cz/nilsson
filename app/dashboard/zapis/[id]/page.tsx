/**
 * app/dashboard/zapis/[id]/page.tsx
 * Server Component — director-only detail žádosti + zápis rozhodnutí.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  getEnrollmentApplicationDetail,
  getEnrollmentGuardians,
  getEnrollmentDecisions,
} from '@/lib/enrollment/dashboard-queries'
import { STAV_LABELS, STAV_VARIANT, VEKOVA_KATEGORIE_LABELS, type EnrollmentVekovaKategorie, type EnrollmentStav } from '@/lib/enrollment/types'
import { ROZHODNUTI_LABELS, dostupneAkce } from '@/lib/enrollment/rozhodnuti'
import DecisionForm from './_components/DecisionForm'

export const metadata = { title: 'Detail žádosti — IS Nilsson' }
export const dynamic = 'force-dynamic'

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
}

function Radek({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b border-gray-50 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium text-right">{value ?? '—'}</span>
    </div>
  )
}

export default async function ZapisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user!.id)
    .maybeSingle()
  const isDirector = (staffRaw as any)?.role === 'director'

  if (!isDirector) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const app = await getEnrollmentApplicationDetail(id)
  if (!app) notFound()

  const [guardians, decisions] = await Promise.all([
    getEnrollmentGuardians(id),
    getEnrollmentDecisions(id),
  ])

  const owner = guardians.find((g) => g.role_v_zadosti === 'vlastnik')
  const coGuardians = guardians.filter((g) => g.role_v_zadosti !== 'vlastnik')
  const akce = dostupneAkce(app.stav, app.typ)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/zapis" className="text-sm text-gray-400 hover:text-gray-600">
          ← Zpět na seznam
        </Link>
        <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
          <h1 className="text-2xl font-semibold text-gray-900">
            {app.dite_jmeno} {app.dite_prijmeni}
          </h1>
          <span className={`portal-pill portal-pill-${STAV_VARIANT[app.stav as EnrollmentStav]}`}>
            {STAV_LABELS[app.stav as EnrollmentStav]}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">
          {app.typ === 'zapis' ? 'Zápis' : 'Přestup'} · nar. {formatDate(app.datum_narozeni)}
          {app.spis_id && (
            <>
              {' · '}
              <Link href={`/dashboard/spisovka/spisy/${app.spis_id}`} className="text-orange-600 hover:underline">
                eSSL spis
              </Link>
            </>
          )}
        </p>
      </div>

      {/* Rozhodnutí */}
      <DecisionForm applicationId={app.id} dostupneRozhodnuti={akce} />

      {/* Nápověda k odkladu — legislativní práh */}
      {(app.melo_odklad || app.vekova_kategorie === 'po_odkladu' || app.vyzaduje_ppp) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-2">
          <h2 className="text-sm font-semibold text-amber-900 uppercase tracking-wide">
            Věková klasifikace / odklad
          </h2>
          <Radek
            label="Kategorie"
            value={
              app.vekova_kategorie
                ? VEKOVA_KATEGORIE_LABELS[app.vekova_kategorie as EnrollmentVekovaKategorie]
                : '—'
            }
          />
          {app.melo_odklad && (
            <Radek
              label="Režim odkladu"
              value={
                app.odklad_rezim === 'novy'
                  ? 'Nová pravidla — vyžaduje specialistu/klin. psychologa'
                  : app.odklad_rezim === 'stary'
                  ? 'Stará pravidla — stačí pediatr'
                  : '—'
              }
            />
          )}
          {app.vyzaduje_ppp && <Radek label="Vyžaduje" value="Doporučení PPP/SPC" />}
          {app.vyzaduje_lekare && <Radek label="Vyžaduje" value="Doporučení dětského lékaře" />}
          {app.vyzaduje_specialistu && <Radek label="Vyžaduje" value="Doporučení specialisty / klin. psychologa" />}
          <Radek
            label="Doklad PPP"
            value={app.odklad_ppp_stav === 'prijato' ? 'Přijato' : 'Nedodáno'}
          />
          <Radek
            label="Doklad lékař"
            value={app.odklad_lekar_stav === 'prijato' ? 'Přijato' : 'Nedodáno'}
          />
        </div>
      )}

      {/* Dítě */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">Dítě</h2>
        <Radek label="Rodné číslo" value={app.rodne_cislo} />
        <Radek label="Místo narození" value={app.misto_narozeni} />
        <Radek label="Státní občanství" value={app.statni_obcanstvi} />
        <Radek label="Pohlaví" value={app.pohlavi} />
        <Radek
          label="Trvalé bydliště"
          value={`${app.dite_trvale_bydliste_ulice ? app.dite_trvale_bydliste_ulice + ' ' : ''}${app.dite_trvale_bydliste_cislo}, ${app.dite_trvale_bydliste_psc} ${app.dite_trvale_bydliste_obec}`}
        />
        {app.dite_bydli_jinde && (
          <Radek
            label="Kontaktní adresa"
            value={`${app.dite_kontaktni_adresa_ulice ? app.dite_kontaktni_adresa_ulice + ' ' : ''}${app.dite_kontaktni_adresa_cislo}, ${app.dite_kontaktni_adresa_psc} ${app.dite_kontaktni_adresa_obec}`}
          />
        )}
        <Radek label="Zdravotní pojišťovna" value={app.zdravotni_pojistovna} />
        <Radek label="Lékař" value={app.lekar} />
        <Radek label="Zdravotní omezení" value={app.zdravotni_omezeni} />
        <Radek label="Specifické potřeby" value={app.specificke_potreby} />
        <Radek label="Budoucí ročník" value={app.budouci_rocnik} />
        <Radek label="Dosavadní škola" value={app.dosavadni_skola} />
        <Radek label="Další informace" value={app.dalsi_informace} />
      </div>

      {/* Přestup-specifické */}
      {app.typ === 'prestup' && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">Přestup</h2>
          <Radek label="K datu" value={formatDate(app.prestup_k_datu)} />
          <Radek label="Současná škola" value={app.soucasna_skola} />
          <Radek label="Současná třída" value={app.soucasna_trida} />
          <Radek label="Individuální vzdělávání" value={app.individualni_vzdelavani ? 'Ano' : 'Ne'} />
          <Radek label="Doporučení" value={app.prestup_doporuceni_stav} />
        </div>
      )}

      {/* Zástupci */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">Zákonní zástupci</h2>
        {owner && (
          <div className="mb-3">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Vlastník žádosti</p>
            <Radek label="Jméno" value={`${owner.first_name ?? ''} ${owner.last_name ?? ''}`} />
            <Radek label="Vztah" value={owner.pribuzensky_vztah} />
            <Radek label="E-mail" value={owner.email} />
            <Radek label="Telefon" value={owner.telefon} />
          </div>
        )}
        {coGuardians.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Spoluzástupci</p>
            {coGuardians.map((g) => (
              <div key={g.id} className="mb-2">
                <Radek label="Jméno" value={`${g.first_name ?? ''} ${g.last_name ?? ''}`.trim() || g.email} />
                <Radek label="E-mail" value={g.email} />
                <Radek label="Stav pozvánky" value={g.stav} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historie rozhodnutí */}
      {decisions.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-2">Historie rozhodnutí</h2>
          <div className="space-y-2">
            {decisions.map((d) => (
              <div key={d.id} className="text-sm border-b border-gray-50 last:border-0 py-2">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-900">
                    {ROZHODNUTI_LABELS[d.rozhodnuti as keyof typeof ROZHODNUTI_LABELS] ?? d.rozhodnuti}
                  </span>
                  <span className="text-gray-400">{formatDate(d.created_at)}</span>
                </div>
                {d.duvod && <p className="text-gray-500 mt-0.5">{d.duvod}</p>}
                {d.datum_nastupu && (
                  <p className="text-gray-500 mt-0.5">
                    Nástup: {formatDate(d.datum_nastupu)}
                    {d.cilovy_school_year && ` (${d.cilovy_school_year})`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
