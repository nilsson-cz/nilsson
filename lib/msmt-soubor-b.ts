/**
 * lib/msmt-soubor-b.ts
 * Věty anonymizovaného souboru „b“ (ZSb.22, jen podzimní sběr) z modulu VP:
 * jedna věta za každé podpůrné opatření s kódem NFN (vp_podpurna_opatreni).
 *
 * Pravidla (Metodické poznámky MŠMT 2026, str. 6, 28–31):
 *   - jen PO z doporučení ŠPZ s převažujícím stupněm 2–5 a kódem NFN,
 *   - jen kód určený pro školu (A na 7. místě KOD_NFN), ne pro školské zařízení,
 *   - až od skutečného zahájení poskytování (PLAT_ZAC = poskytovano_od, výkaz R 44-99),
 *   - PLAT_KON = skutečné ukončení, nikdy po RDAT (budoucí konec se neuvádí),
 *   - DAT_VYD / DAT_KPD z naposledy vydaného platného doporučení žáka,
 *   - ID_ZNEV a PSPO shodné se souborem „a“,
 *   - TT = typ třídy: B běžná třída (škola nemá třídy podle § 16 odst. 9).
 * Předávají se opatření, jejichž poskytování zasahuje do období sběru (jako věty
 * souboru „a“); skončená mají vyplněný PLAT_KON.
 */

import type { createSupabaseServerClient } from '@/lib/supabase-server'
import type { SberKontext } from '@/lib/msmt-sber'
import { jePoProSouborB } from '@/lib/vp-doporuceni-shared'

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

export interface VetaB {
  studentId: string
  kod_zaka: string
  tt: 'B' | 'Z'
  izo_spz: string
  dat_vyd: string        // ISO
  dat_kpd: string        // ISO
  pspo: number
  kod_nfn: string
  fpp: string | null
  fn: string
  dat_zah: string | null // ISO
  dat_ukon: string | null
  id_znev: string
  plat_zac: string       // ISO
  plat_kon: string | null
}

interface DopRow {
  id: string; student_id: string; platnost_od: string; platnost_do: string | null; ukonceno_k: string | null
  pspo: number; id_znev: string | null; id_znev_dalsi: string | null
  izo_spz: string | null; datum_vydani: string | null
}
interface PoRow {
  doporuceni_id: string; druh: string; kod_nfn: string | null; fpp: string | null; fn: string
  datum_zahajeni: string | null; datum_ukonceni: string | null
  poskytovano_od: string | null; poskytovano_do: string | null
}

export interface DataSouboruB { doporuceni: DopRow[]; opatreni: PoRow[] }

export async function nactiDataSouboruB(supabase: Supabase, studentIds: string[]): Promise<DataSouboruB> {
  if (studentIds.length === 0) return { doporuceni: [], opatreni: [] }
  const { data: dop, error } = await supabase
    .from('vp_doporuceni')
    .select('id, student_id, platnost_od, platnost_do, ukonceno_k, pspo, id_znev, id_znev_dalsi, izo_spz, datum_vydani')
    .in('student_id', studentIds)
  if (error) throw new Error(`soubor „b“: ${error.message}`)
  if (!dop?.length) return { doporuceni: [], opatreni: [] }
  const { data: po, error: poErr } = await supabase
    .from('vp_podpurna_opatreni')
    .select('doporuceni_id, druh, kod_nfn, fpp, fn, datum_zahajeni, datum_ukonceni, poskytovano_od, poskytovano_do')
    .in('doporuceni_id', dop.map((d) => d.id))
  if (poErr) throw new Error(`soubor „b“: ${poErr.message}`)
  return { doporuceni: dop as DopRow[], opatreni: (po ?? []) as PoRow[] }
}

function platiKDatu(d: DopRow, iso: string): boolean {
  return d.platnost_od <= iso && (!(d.ukonceno_k ?? d.platnost_do) || (d.ukonceno_k ?? d.platnost_do)! >= iso)
}

export interface VysledekB {
  vety: VetaB[]
  /** Blokující chyby (chybí údaj, bez kterého větu nelze sestavit). */
  chyby: string[]
  /** Opatření s kódem pro školu, která se zatím neposkytují (nejdou do „b“). */
  nezahajena: { studentId: string; druh: string; kod_nfn: string }[]
}

/**
 * Sestaví věty „b“ pro žáky (id → jméno pro hlášky, KOD_ZAKA).
 */
export function vetySouboruB(
  data: DataSouboruB,
  zaci: { id: string; jmeno: string; kod_zaka_msmt: string | null }[],
  sber: SberKontext,
): VysledekB {
  const vety: VetaB[] = []
  const chyby: string[] = []
  const nezahajena: VysledekB['nezahajena'] = []
  const rdat = sber.rdatIso
  const dopById = new Map(data.doporuceni.map((d) => [d.id, d]))

  for (const z of zaci) {
    const dopZaka = data.doporuceni.filter((d) => d.student_id === z.id)
    // Naposledy vydané doporučení platné k RDAT (metodika: DAT_VYD / DAT_KPD).
    const posledni = dopZaka.filter((d) => platiKDatu(d, rdat))
      .sort((a, b) => (b.datum_vydani ?? b.platnost_od).localeCompare(a.datum_vydani ?? a.platnost_od))[0]

    for (const po of data.opatreni) {
      const dop = dopById.get(po.doporuceni_id)
      if (!dop || dop.student_id !== z.id) continue
      if (dop.pspo < 2 || !po.kod_nfn || !jePoProSouborB(po)) continue
      if (!po.poskytovano_od || po.poskytovano_od > rdat) {
        if (!po.poskytovano_do && platiKDatu(dop, rdat)) nezahajena.push({ studentId: z.id, druh: po.druh, kod_nfn: po.kod_nfn })
        continue
      }
      if (po.poskytovano_do && po.poskytovano_do < sber.obdobiOd) continue

      const aktivni = !po.poskytovano_do || po.poskytovano_do >= rdat
      const zdroj = aktivni && posledni ? posledni : dop
      const chybi = [
        !z.kod_zaka_msmt ? 'KOD_ZAKA' : null,
        !zdroj.izo_spz ? 'IZO poradny' : null,
        !zdroj.datum_vydani ? 'datum vydání doporučení' : null,
        !zdroj.platnost_do ? 'platnost doporučení do' : null,
        !dop.id_znev ? 'identifikátor znevýhodnění' : null,
      ].filter(Boolean)
      if (chybi.length) {
        chyby.push(`${z.jmeno} (${po.kod_nfn}): chybí ${chybi.join(', ')}`)
        continue
      }
      vety.push({
        studentId: z.id,
        kod_zaka: z.kod_zaka_msmt!,
        tt: 'B',
        izo_spz: zdroj.izo_spz!,
        dat_vyd: zdroj.datum_vydani!,
        dat_kpd: zdroj.platnost_do!,
        pspo: dop.pspo,
        kod_nfn: po.kod_nfn,
        fpp: po.fpp,
        fn: po.fn,
        dat_zah: po.datum_zahajeni,
        dat_ukon: po.datum_ukonceni,
        id_znev: dop.id_znev! + (dop.id_znev_dalsi ?? ''),
        plat_zac: po.poskytovano_od,
        plat_kon: po.poskytovano_do && po.poskytovano_do <= rdat ? po.poskytovano_do : null,
      })
    }
  }
  vety.sort((a, b) => a.kod_zaka.localeCompare(b.kod_zaka) || a.plat_zac.localeCompare(b.plat_zac) || a.kod_nfn.localeCompare(b.kod_nfn))
  return { vety, chyby, nezahajena }
}
