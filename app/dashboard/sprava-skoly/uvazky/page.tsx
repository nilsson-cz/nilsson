/**
 * app/dashboard/sprava-skoly/uvazky/page.tsx
 * Server Component — director-only: nárazové zadání úvazků pedagogů ve školní
 * družině k rozhodnému datu (staff_uvazky_k_datu, migrace 150). Podklad výkazu
 * Z 2-01, oddíl XIV (PRD-vykaz-z201-druzina-2026-10-06, § 5.2).
 *
 * Rozhodné datum = 31. 10. aktuálního školního roku (?rdat= jiné datum).
 * Bez uloženého zadání se předvyplní poslední dřívější zadání, jinak
 * zaměstnanci s rolí vychovatel platnou k datu. Pohlaví z RČ se posílá
 * klientovi jen jako příznak (RČ neopouští server).
 */

import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { computeSchoolYear } from '@/lib/school-year'
import { pohlaviZRodnehoCisla, zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { pracovniHodinyRijna, type PoziceSd, type UvazekSd } from '@/lib/uvazky-z201'
import UvazkyEditor, { type Pracovnik } from './_components/UvazkyEditor'

export const metadata = { title: 'Úvazky v družině k datu — IS Nilsson' }

type UvazekRow = {
  rdat: string; staff_id: string; pozice: string; interni: boolean
  uvazek: number | null; hodiny_rijen: number | null; zena: boolean
  nepritomen: boolean; poznamka: string | null
}

const RE_DATUM = /^\d{4}-\d{2}-\d{2}$/

function fmt(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}. ${Number(m)}. ${y}`
}

export default async function UvazkyPage({
  searchParams,
}: {
  searchParams: Promise<{ rdat?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = await supabase.from('staff').select('role').eq('user_id', user!.id).maybeSingle()

  if ((me as { role?: string } | null)?.role !== 'director') {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4">Úvazky v družině</h1>
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
          Tato sekce je dostupná pouze pro ředitele.
        </div>
      </div>
    )
  }

  const zadane = (await searchParams).rdat
  const vychozi = `${computeSchoolYear(new Date()).slice(0, 4)}-10-31`
  const rdat = zadane && RE_DATUM.test(zadane) ? zadane : vychozi

  const [{ data: staffRaw }, { data: roleRaw }, { data: ulozeneRaw }, { data: drivejsiRaw }] = await Promise.all([
    supabase.from('staff')
      .select('id, first_name, last_name, birth_number, employment_type, employment_start, employment_end, typ_zamestnance')
      .order('last_name').order('first_name'),
    supabase.from('staff_roles').select('staff_id, role, valid_from, valid_to').eq('role', 'vychovatel'),
    supabase.from('staff_uvazky_k_datu')
      .select('rdat, staff_id, pozice, interni, uvazek, hodiny_rijen, zena, nepritomen, poznamka')
      .eq('rdat', rdat),
    supabase.from('staff_uvazky_k_datu')
      .select('rdat, staff_id, pozice, interni, uvazek, hodiny_rijen, zena, nepritomen, poznamka')
      .lt('rdat', rdat)
      .order('rdat', { ascending: false })
      .limit(200),
  ])

  // Pracovníci k datu (pedagogičtí, v pracovním vztahu k rdat) — pro výběr do tabulky.
  const pracovnici: Pracovnik[] = (staffRaw ?? [])
    .filter((s) => s.typ_zamestnance === 'pedagogicky'
      && (!s.employment_start || s.employment_start <= rdat)
      && (!s.employment_end || s.employment_end >= rdat))
    .map((s) => {
      const rc = zkontrolujRodneCislo(s.birth_number)
      return {
        id: s.id,
        jmeno: `${s.last_name} ${s.first_name}`,
        zena: rc.stav === 'ok' && rc.rodc ? pohlaviZRodnehoCisla(rc.rodc) === 'zena' : null,
        externi: s.employment_type === 'dpp' || s.employment_type === 'dpc',
      }
    })

  const naUvazek = (r: UvazekRow): UvazekSd => ({
    staff_id: r.staff_id,
    pozice: r.pozice as PoziceSd,
    interni: r.interni,
    uvazek: r.uvazek === null ? null : Number(r.uvazek),
    hodiny_rijen: r.hodiny_rijen === null ? null : Number(r.hodiny_rijen),
    zena: r.zena,
    nepritomen: r.nepritomen,
    poznamka: r.poznamka,
  })

  const ulozene = ((ulozeneRaw ?? []) as UvazekRow[]).map(naUvazek)
  let pocatecni = ulozene
  let zdroj: string
  if (ulozene.length > 0) {
    zdroj = 'Uložené zadání k tomuto datu.'
  } else {
    const drivejsi = (drivejsiRaw ?? []) as UvazekRow[]
    const posledni = drivejsi[0]?.rdat
    if (posledni) {
      // Hodiny za říjen se z minula nepřebírají — každý rok jiné.
      pocatecni = drivejsi.filter((r) => r.rdat === posledni).map(naUvazek)
        .map((u) => (u.interni ? u : { ...u, hodiny_rijen: null }))
      zdroj = `Předvyplněno ze zadání k ${fmt(posledni)} — zkontrolujte a uložte.`
    } else {
      const vychovatele = new Set((roleRaw ?? [])
        .filter((r) => r.valid_from <= rdat && (!r.valid_to || r.valid_to >= rdat))
        .map((r) => r.staff_id))
      pocatecni = pracovnici.filter((p) => vychovatele.has(p.id)).map((p) => ({
        staff_id: p.id,
        pozice: 'vychovatel_sd' as PoziceSd,
        interni: !p.externi,
        uvazek: null,
        hodiny_rijen: null,
        zena: p.zena ?? true,
        nepritomen: false,
        poznamka: null,
      }))
      zdroj = 'Předvyplněno podle role vychovatel — doplňte úvazky a uložte.'
    }
  }

  // Pracovníci v uložených / předvyplněných řádcích, kteří už nejsou v seznamu (odešli).
  const znami = new Set(pracovnici.map((p) => p.id))
  for (const u of pocatecni) {
    if (!znami.has(u.staff_id)) {
      const s = (staffRaw ?? []).find((x) => x.id === u.staff_id)
      pracovnici.push({ id: u.staff_id, jmeno: s ? `${s.last_name} ${s.first_name}` : 'neznámý pracovník', zena: u.zena, externi: !u.interni })
      znami.add(u.staff_id)
    }
  }

  const rokRijna = Number(rdat.slice(0, 4)) - (Number(rdat.slice(5, 7)) < 10 ? 1 : 0)
  const hodinyRijna = pracovniHodinyRijna(rokRijna)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/sprava-skoly" className="text-xs text-gray-500 hover:underline">← Správa školy</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Úvazky v družině k {fmt(rdat)}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Podklad pro výkaz Z 2-01 (oddíl XIV). Uvádějte jen práci v družině: úvazek ve škole
          (učitel, asistent ve třídě) sem nepatří. Interní pracovník = pracovní poměr (úvazek jako
          podíl, např. 0,6), externí = dohoda (hodiny odpracované v říjnu). Dlouhodobě nepřítomný se
          nevykazuje — uveďte jeho náhradu.
        </p>
        <form className="mt-3 flex items-end gap-2 text-sm">
          <label>
            <span className="block text-xs text-gray-500 mb-1">Rozhodné datum</span>
            <input type="date" name="rdat" defaultValue={rdat} className="rounded border border-gray-300 px-2 py-1" />
          </label>
          <button type="submit" className="rounded border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50">Zobrazit</button>
        </form>
      </div>

      <UvazkyEditor
        key={rdat}
        rdat={rdat}
        pocatecni={pocatecni}
        pracovnici={pracovnici}
        hodinyRijna={hodinyRijna}
        rokRijna={rokRijna}
        zdroj={zdroj}
        ulozeno={ulozene.length > 0}
      />
    </div>
  )
}
