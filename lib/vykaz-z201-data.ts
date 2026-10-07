// lib/vykaz-z201-data.ts
// Načtení vstupů výkazu Z 2-01 z DB (bez PostgREST embed) → VstupZ201
// pro čistý výpočet v lib/vykaz-z201.ts. Server-only (Supabase klient).
//
// RDAT = 31. 10. RRRR, školní rok RRRR/RRRR+1. Žáci = všichni se zápisem
// do družiny v tom roce (výpočet sám rozhodne, kdo se vykazuje).

import type { createSupabaseServerClient } from '@/lib/supabase-server'
import { pohlaviZRodnehoCisla, zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { stprKod } from '@/lib/msmt-xml'
import { kstprZaka } from '@/lib/msmt-pobyt'
import { kratkyCas } from '@/lib/druzina-provoz'
import { pracovniHodinyRijna, type PoziceSd, type UvazekSd } from '@/lib/uvazky-z201'
import type { VstupZ201, ZakZ201, SvpZ201 } from '@/lib/vykaz-z201'

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** Rozhodné datum a školní rok sběru pro rok RRRR. */
export function sberZ201(rok: number): { rdat: string; skolniRok: string } {
  return { rdat: `${rok}-10-31`, skolniRok: `${rok}/${rok + 1}` }
}

export async function nactiVstupZ201(supabase: Supabase, rok: number): Promise<VstupZ201> {
  const { rdat, skolniRok } = sberZ201(rok)
  const chyba = (co: string, e: { message: string } | null) => {
    if (e) throw new Error(`Z 2-01 (${co}): ${e.message}`)
  }

  const [{ data: zapisy, error: zErr }, { data: oddeleni, error: oErr }, { data: uvazky, error: uErr }] = await Promise.all([
    supabase.from('druzina_enrollments')
      .select('student_id, oddeleni_id, date_from, date_to, dny_dochazky')
      .eq('school_year', skolniRok),
    supabase.from('druzina_oddeleni').select('id, name').eq('school_year', skolniRok).order('name'),
    supabase.from('staff_uvazky_k_datu')
      .select('staff_id, pozice, interni, uvazek, hodiny_rijen, zena, nepritomen, poznamka')
      .eq('rdat', rdat),
  ])
  chyba('zápisy', zErr); chyba('oddělení', oErr); chyba('úvazky', uErr)

  const ids = [...new Set((zapisy ?? []).map((z) => z.student_id))]
  const oddIds = (oddeleni ?? []).map((o) => o.id)

  const prazdne = { data: [], error: null }
  const [studenti, rezimy, clenstvi, doporuceni, pece, provoz] = await Promise.all([
    ids.length ? supabase.from('students')
      .select('id, first_name, last_name, birth_number, citizenship, msmt_kstpr, msmt_sz, msmt_zz, msmt_nadani')
      .in('id', ids) : prazdne,
    ids.length ? supabase.from('student_education_mode')
      .select('student_id, rocnik, valid_from, valid_to').in('student_id', ids) : prazdne,
    ids.length ? supabase.from('group_memberships')
      .select('student_id, group_id, valid_from, valid_to').in('student_id', ids) : prazdne,
    ids.length ? supabase.from('vp_doporuceni')
      .select('id, student_id, platnost_od, platnost_do, ukonceno_k, pspo, id_znev, id_znev_dalsi')
      .in('student_id', ids) : prazdne,
    ids.length ? supabase.from('vp_student_care')
      .select('student_id, school_year, typ_pece, status, closed_at').in('student_id', ids) : prazdne,
    oddIds.length ? supabase.from('druzina_oddeleni_provoz')
      .select('oddeleni_id, den_v_tydnu, cas_od, cas_do').in('oddeleni_id', oddIds) : prazdne,
  ])
  chyba('žáci', studenti.error); chyba('ročníky', rezimy.error); chyba('třídy', clenstvi.error)
  chyba('doporučení', doporuceni.error); chyba('péče VP', pece.error); chyba('provoz', provoz.error)

  type DopRow = { id: string; student_id: string; platnost_od: string; platnost_do: string | null; ukonceno_k: string | null; pspo: number; id_znev: string | null; id_znev_dalsi: string | null }
  const dopRows = (doporuceni.data ?? []) as DopRow[]
  const dopIds = dopRows.map((d) => d.id)

  const groupIds = [...new Set(((clenstvi.data ?? []) as { group_id: string }[]).map((m) => m.group_id))]
  const [skupiny, opatreni] = await Promise.all([
    groupIds.length ? supabase.from('groups').select('id, name').in('id', groupIds) : prazdne,
    dopIds.length ? supabase.from('vp_podpurna_opatreni')
      .select('doporuceni_id, kod_nfn, poskytovano_od, poskytovano_do').in('doporuceni_id', dopIds) : prazdne,
  ])
  chyba('skupiny', skupiny.error); chyba('podpůrná opatření', opatreni.error)

  const nazevSkupiny = new Map(((skupiny.data ?? []) as { id: string; name: string }[]).map((g) => [g.id, g.name]))
  const platiKRdat = (od: string, doIso: string | null) => od <= rdat && (!doIso || doIso >= rdat)

  const zaci: ZakZ201[] = ((studenti.data ?? []) as {
    id: string; first_name: string; last_name: string; birth_number: string | null; citizenship: string | null
    msmt_kstpr: string | null; msmt_sz: string; msmt_zz: string; msmt_nadani: string
  }[]).map((s) => {
    const rc = zkontrolujRodneCislo(s.birth_number)
    const rezim = ((rezimy.data ?? []) as { student_id: string; rocnik: number | null; valid_from: string; valid_to: string | null }[])
      .filter((m) => m.student_id === s.id && platiKRdat(m.valid_from, m.valid_to))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
    const cl = ((clenstvi.data ?? []) as { student_id: string; group_id: string; valid_from: string; valid_to: string | null }[])
      .filter((m) => m.student_id === s.id && platiKRdat(m.valid_from, m.valid_to))
      .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
    return {
      id: s.id,
      jmeno: `${s.last_name} ${s.first_name}`,
      trida: cl ? nazevSkupiny.get(cl.group_id) ?? null : null,
      rocnik: rezim?.rocnik ?? null,
      zena: rc.stav === 'ok' && rc.rodc ? pohlaviZRodnehoCisla(rc.rodc) === 'zena' : null,
      stpr: stprKod(s.citizenship),
      kstpr: kstprZaka(s.citizenship, s.msmt_kstpr),
      msmt_sz: s.msmt_sz,
      msmt_zz: s.msmt_zz,
      msmt_nadani: s.msmt_nadani,
    }
  })

  // SVP k RDAT — stejná pravidla jako soubor „a“ matriky (lib/msmt-soubor-a.ts):
  // doporučení platné k RDAT (naposledy začaté), jinak aktivní péče s PO 1. stupně.
  type PeceRow = { student_id: string; school_year: string; typ_pece: string; status: string; closed_at: string | null }
  type PoRow = { doporuceni_id: string; kod_nfn: string | null; poskytovano_od: string | null; poskytovano_do: string | null }
  const svp: SvpZ201[] = ids.map((id) => {
    const dopZaka = dopRows.filter((d) => d.student_id === id)
    const dop = dopZaka
      .filter((d) => platiKRdat(d.platnost_od, d.ukonceno_k ?? d.platnost_do))
      .sort((a, b) => b.platnost_od.localeCompare(a.platnost_od))[0]
    const plpp = !dop && ((pece.data ?? []) as PeceRow[]).some((c) =>
      c.student_id === id && c.school_year === skolniRok && c.typ_pece === 'po_1'
      && (c.status === 'active' || (c.closed_at != null && rdat <= c.closed_at)))
    const dopZakaIds = new Set(dopZaka.map((d) => d.id))
    const poDruziny = ((opatreni.data ?? []) as PoRow[])
      .filter((p) => dopZakaIds.has(p.doporuceni_id) && !!p.kod_nfn && p.kod_nfn.charAt(6) === 'B')
    const poDruzinaNfn = poDruziny
      .filter((p) => !!p.poskytovano_od && platiKRdat(p.poskytovano_od, p.poskytovano_do))
      .map((p) => p.kod_nfn as string)
    // PO pro družinu z platného doporučení, u kterého chybí datum zahájení poskytování.
    const poDruzinaNezahajena = !!dop && poDruziny.some((p) => p.doporuceni_id === dop.id && !p.poskytovano_od && !p.poskytovano_do)
    return {
      studentId: id,
      doporuceni: dop ? { pspo: dop.pspo, idZnev: dop.id_znev, idZnevDalsi: dop.id_znev_dalsi } : null,
      plpp,
      poDruzinaNfn,
      poDruzinaNezahajena,
    }
  })

  const provozRows = (provoz.data ?? []) as { oddeleni_id: string; den_v_tydnu: number; cas_od: string; cas_do: string }[]

  return {
    rdat,
    zapisy: (zapisy ?? []).map((z) => ({
      studentId: z.student_id,
      oddeleniId: z.oddeleni_id,
      dateFrom: z.date_from,
      dateTo: z.date_to,
      dny: z.dny_dochazky ?? [],
    })),
    zaci,
    svp,
    oddeleni: (oddeleni ?? []).map((o) => ({
      id: o.id,
      nazev: o.name,
      provoz: provozRows.filter((p) => p.oddeleni_id === o.id)
        .map((p) => ({ den: p.den_v_tydnu, od: kratkyCas(p.cas_od), do: kratkyCas(p.cas_do) })),
    })),
    uvazky: (uvazky ?? []).map((u): UvazekSd => ({
      staff_id: u.staff_id,
      pozice: u.pozice as PoziceSd,
      interni: u.interni,
      uvazek: u.uvazek === null ? null : Number(u.uvazek),
      hodiny_rijen: u.hodiny_rijen === null ? null : Number(u.hodiny_rijen),
      zena: u.zena,
      nepritomen: u.nepritomen,
      poznamka: u.poznamka,
    })),
    uvazkyZadane: (uvazky ?? []).length > 0,
    hodinyRijna: pracovniHodinyRijna(rok),
  }
}
