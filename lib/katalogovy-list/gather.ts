// lib/katalogovy-list/gather.ts
// Server-only sběr dat pro katalogový list žáka. Čte z existujících tabulek
// (žádná datová migrace). Prospěch = poslední UZAVŘENÝ školní rok (obě pololetí);
// známky se dopočítávají čistou funkcí prevodNaZnamku (viz ./znamka).

import 'server-only'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, prevSchoolYear } from '@/lib/school-year'
import { getVystupyWithHodnoceni } from '@/lib/mapa-pokroku'
import { prevodNaZnamku, type Stupen, type ZnamkaVysledek } from './znamka'
import { getStudentAddresses, getGuardianAddresses, formatAddressLine } from '@/lib/addresses'
import type {
  KatalogovyListData,
  KLPredmetProspech,
  KLZakonnyZastupce,
} from './types'

// --- popisky číselníků ---

const VZTAH_LABEL: Record<string, string> = {
  matka: 'matka',
  otec: 'otec',
  porucnik: 'poručník',
  opatrovnik: 'opatrovník',
  pestoun: 'pěstoun',
  sverena_pece: 'osoba se svěřenou péčí',
  jiny_zz: 'jiný zákonný zástupce',
  kontaktni_osoba: 'kontaktní osoba',
}

// Způsob plnění PŠD. POZOR: DB enum zpusob_plneni_psd (000_init.sql) je vlastní
// zjednodušená sada 11/30/40/50, NE plný číselník MŠMT RASD (ten má 11,12,15,21–25,30
// a 40/50 vůbec nezná). Labely níže sladěné s RASD tam, kde se překrývá, a se
// správnými paragrafy (komentář v init.sql u 30 chybně uváděl §38 — správně §41).
const ZPUSOB_PSD_LABEL: Record<string, string> = {
  '11': 'běžná školní docházka',
  '30': 'individuální vzdělávání (§ 41 ŠZ)',
  '40': 'plnění PŠD v zahraničí / v zahraniční škole (§ 38 ŠZ)',
  '50': 'jiný způsob plnění PŠD (§ 42 ŠZ)',
}

const VP_PECE_LABEL: Record<string, string> = {
  watch: 'sledování',
  po_1: 'podpůrné opatření 1. stupně',
  po_2: 'podpůrné opatření 2. stupně',
  po_3: 'podpůrné opatření 3. stupně',
  po_4: 'podpůrné opatření 4. stupně',
  po_5: 'podpůrné opatření 5. stupně',
}

function formatAdresa(
  street: string | null,
  city: string | null,
  zip: string | null
): string | null {
  const radek2 = [zip, city].filter(Boolean).join(' ')
  const cele = [street, radek2].filter(Boolean).join(', ')
  return cele || null
}

/** Matriční záznam (ročník + způsob PŠD) platný k referenčnímu datu. */
async function eduModeKDatu(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  studentId: string,
  refDate: string
): Promise<{ rocnik: number | null; zpusob: string | null }> {
  const { data } = await supabase
    .from('student_education_mode')
    .select('rocnik, zpusob')
    .eq('student_id', studentId)
    .lte('valid_from', refDate)
    .or(`valid_to.is.null,valid_to.gte.${refDate}`)
    .order('valid_from', { ascending: false })
    .limit(1)
    .maybeSingle()
  return {
    rocnik: (data?.rocnik as number | null) ?? null,
    zpusob: (data?.zpusob as string | null) ?? null,
  }
}

/** Sestaví prospěch (obě pololetí) pro daný ročník a uzavřený rok. */
async function sestavProspech(
  studentId: string,
  rocnik: number,
  closedYear: string
): Promise<KLPredmetProspech[]> {
  const [p1, p2] = await Promise.all([
    getVystupyWithHodnoceni(studentId, rocnik, closedYear, 1),
    getVystupyWithHodnoceni(studentId, rocnik, closedYear, 2),
  ])

  const predmety = Array.from(
    new Set([...Object.keys(p1), ...Object.keys(p2)])
  ).sort((a, b) => a.localeCompare(b, 'cs'))

  const kompetence = (
    vystupy: { vystup_text: string; hodnoceni: { stupen: Stupen } | null }[] | undefined
  ) =>
    (vystupy ?? []).map((v) => ({
      text: v.vystup_text,
      stupen: (v.hodnoceni?.stupen ?? null) as Stupen | null,
    }))

  const znamka = (kompetence: { stupen: Stupen | null }[]): ZnamkaVysledek =>
    prevodNaZnamku(kompetence.map((k) => k.stupen))

  return predmety.map((predmet) => {
    const kompetenceP1 = kompetence(p1[predmet])
    const kompetenceP2 = kompetence(p2[predmet])
    return {
      predmet,
      znamkaP1: znamka(kompetenceP1),
      znamkaP2: znamka(kompetenceP2),
      kompetenceP1,
      kompetenceP2,
    }
  })
}

export async function gatherKatalogovyList(
  studentId: string
): Promise<KatalogovyListData | null> {
  const supabase = await createSupabaseServerClient()
  const today = new Date().toISOString().slice(0, 10)

  const activeYear = await getActiveSchoolYear()
  const closedYear = prevSchoolYear(activeYear)
  const closedYearRef = `${closedYear.split('/')[0]}-11-15` // uprostřed 1. pololetí

  // --- žák ---
  const { data: s } = await supabase
    .from('students')
    .select(
      `first_name, last_name, kod_zaka, birth_number, birth_date, birth_place,
       citizenship, nationality, enrollment_date, withdrawal_date,
       has_svp, svp_detail, health_fitness_note, predchozi_vzdelavani`
    )
    .eq('id', studentId)
    .maybeSingle()
  if (!s) return null
  const student = s as Record<string, any>

  // --- třída (nejnovější členství) ---
  const { data: memberships } = await supabase
    .from('group_memberships')
    .select('school_year, group_id, groups(name)')
    .eq('student_id', studentId)
    .order('valid_from', { ascending: false })
  const currentMembership = (memberships as any[])?.[0] ?? null

  // --- zákonní zástupci ---
  const { data: gl } = await supabase
    .from('student_guardian_links')
    .select(
      `role, je_primarni_kontakt, guardian_id,
       guardians(first_name, last_name, email, phone_primary, phone_secondary,
                 address_street, address_city, address_zip, address_delivery)`
    )
    .eq('student_id', studentId)
    .eq('je_zakonny_zastupce', true)
    .is('platnost_do', null)
    .order('je_primarni_kontakt', { ascending: false })

  // Jednotný adresní model (M3): addresses = zdroj, guardians.address_* = fallback.
  const guardianIds = ((gl ?? []) as { guardian_id: string | null }[])
    .map((l) => l.guardian_id)
    .filter((x): x is string => !!x)
  const [studAddr, guardAddr] = await Promise.all([
    getStudentAddresses(supabase, studentId),
    getGuardianAddresses(supabase, guardianIds),
  ])

  const zastupci: KLZakonnyZastupce[] = ((gl as any[]) ?? []).map((l) => {
    const g = l.guardians ?? {}
    const a = l.guardian_id ? guardAddr.get(l.guardian_id)?.trvale ?? null : null
    return {
      jmeno: [g.first_name, g.last_name].filter(Boolean).join(' '),
      vztah: VZTAH_LABEL[l.role] ?? l.role,
      bydliste: formatAddressLine(a) ?? formatAdresa(g.address_street, g.address_city, g.address_zip),
      telefon: g.phone_primary ?? g.phone_secondary ?? null,
      email: g.email ?? null,
    }
  })

  // Adresa žáka: addresses (trvalé/kontaktní) → fallback adresa primárního ZZ (PRD R9).
  const primar = ((gl as any[]) ?? [])[0]?.guardians ?? null
  const trvaleFallback = primar
    ? formatAdresa(primar.address_street, primar.address_city, primar.address_zip)
    : null
  const trvale = formatAddressLine(studAddr.trvale) ?? trvaleFallback
  const korespondencni =
    formatAddressLine(studAddr.kontaktni) ?? primar?.address_delivery ?? trvale

  // --- předchozí vzdělávání ---
  const { data: history } = await supabase
    .from('student_school_history')
    .select('school_name, school_izo, school_address, period_from, period_to')
    .eq('student_id', studentId)
    .order('period_from', { ascending: true })

  // --- podpůrná opatření (otevřené záznamy VP péče) ---
  const { data: pece } = await supabase
    .from('vp_student_care')
    .select('typ_pece, ivp_required, closed_at')
    .eq('student_id', studentId)
    .is('closed_at', null)

  // --- ročníky ---
  const [eduSoucasny, eduUzavreny] = await Promise.all([
    eduModeKDatu(supabase, studentId, today),
    eduModeKDatu(supabase, studentId, closedYearRef),
  ])
  const rocnikSoucasny = eduSoucasny.rocnik
  const rocnikUzavrenehoRoku = eduUzavreny.rocnik

  // --- prospěch (poslední uzavřený rok) ---
  const predmety = rocnikUzavrenehoRoku
    ? await sestavProspech(studentId, rocnikUzavrenehoRoku, closedYear)
    : []
  const prospech =
    rocnikUzavrenehoRoku && predmety.length > 0
      ? { rok: closedYear, rocnik: rocnikUzavrenehoRoku, predmety }
      : null

  // --- výchovná opatření ---
  const { data: dm } = await supabase
    .from('disciplinary_measures')
    .select('measure_type, measure_date, justification_text')
    .eq('student_id', studentId)
    .order('measure_date', { ascending: false })

  // --- docházka (souhrn uzavřeného roku) ---
  const { data: att } = await supabase
    .from('semester_attendance_summary')
    .select('semester, oml_h, neoml_h, transfer_hours_oml, transfer_hours_neoml')
    .eq('student_id', studentId)
    .eq('school_year', closedYear)

  const dochazkaProSemestr = (sem: number) => {
    const rows = ((att as any[]) ?? []).filter((r) => r.semester === sem)
    if (rows.length === 0) return null
    return rows.reduce(
      (acc, r) => ({
        oml: acc.oml + (r.oml_h ?? 0) + (r.transfer_hours_oml ?? 0),
        neoml: acc.neoml + (r.neoml_h ?? 0) + (r.transfer_hours_neoml ?? 0),
      }),
      { oml: 0, neoml: 0 }
    )
  }
  const dochazkaSouhrn =
    (att as any[])?.length > 0
      ? { rok: closedYear, p1: dochazkaProSemestr(1), p2: dochazkaProSemestr(2) }
      : null

  // --- poslední ŠVP ---
  const { data: programs } = await supabase
    .from('school_programs')
    .select('svp_name, svp_file_number, svp_valid_from')
    .order('svp_valid_from', { ascending: false, nullsFirst: false })
    .limit(1)
  const program = (programs as any[])?.[0] ?? null

  return {
    vytvorenoDne: today,
    identifikace: {
      jmeno: student.first_name,
      prijmeni: student.last_name,
      kodZaka: student.kod_zaka,
      rodneCislo: student.birth_number ?? null,
      datumNarozeni: student.birth_date ?? null,
      mistoNarozeni: student.birth_place ?? null,
      statniPrislusnost: student.citizenship ?? student.nationality ?? null,
      trida: currentMembership?.groups?.name ?? null,
      skolniRok: currentMembership?.school_year ?? null,
    },
    dochazkaSkola: {
      vedenOd: student.enrollment_date ?? null,
      vedenDo: student.withdrawal_date ?? null,
      pocetLetPsd:
        rocnikSoucasny != null ? Math.max(rocnikSoucasny - 1, 0) : null,
      zpusobPsd: eduSoucasny.zpusob
        ? ZPUSOB_PSD_LABEL[eduSoucasny.zpusob] ?? `kód ${eduSoucasny.zpusob}`
        : null,
    },
    adresa: { trvale, korespondencni },
    zastupci,
    predchoziVzdelavani: {
      skoly: ((history as any[]) ?? []).map((h) => ({
        nazev: h.school_name,
        izo: h.school_izo ?? null,
        adresa: h.school_address ?? null,
        obdobiOd: h.period_from ?? null,
        obdobiDo: h.period_to ?? null,
      })),
      poznamka: student.predchozi_vzdelavani ?? null,
    },
    podpurnaOpatreni: {
      maSvp: !!student.has_svp,
      detail: student.svp_detail ?? null,
      pece: ((pece as any[]) ?? []).map((p) => ({
        typ: VP_PECE_LABEL[p.typ_pece] ?? p.typ_pece,
        ivp: !!p.ivp_required,
      })),
    },
    zdravotniZpusobilost: student.health_fitness_note ?? null,
    vyucovaciJazyk: 'český',
    prospech,
    vychovnaOpatreni: ((dm as any[]) ?? []).map((m) => ({
      typ: m.measure_type,
      datum: m.measure_date ?? null,
      zduvodneni: m.justification_text,
    })),
    dochazkaSouhrn,
    posledniSvp: program
      ? { nazev: program.svp_name, cisloJednaci: program.svp_file_number ?? null }
      : null,
  }
}
