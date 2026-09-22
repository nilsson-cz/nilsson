// app/dashboard/zaci/[id]/studijni-smlouva/route.ts
// GET → PDF „Studijní smlouva" pro přijatého žáka. Guard: ředitel.
// Data z matriky (students + student_guardian_links + student_education_mode +
// group_memberships). Co v IS není (nar. rodičů, podpisy, datum) → tečkovaná
// linka v PDF. Délka = počet zbývajících ročníků, školné/ročníky/rok lze
// přepsat query parametry (formulář na kartě žáka).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  renderStudijniSmlouvaPdf,
  type SmlouvaRodic,
  type StudijniSmlouvaData,
} from '@/lib/studijni-smlouva/pdf'
import {
  getStudentAddresses,
  getGuardianAddresses,
  formatAddressLine,
  formatStreet,
  type AddressRow,
} from '@/lib/addresses'

export const runtime = 'nodejs'

const DEFAULT_SKOLNE = Number(process.env.SCHOOL_TUITION_MONTHLY ?? '4400')

function asciiSlug(str: string): string {
  return (
    str
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'zak'
  )
}

type GuardianRow = {
  role: string | null
  je_primarni_kontakt: boolean | null
  guardian_id: string | null
  guardians: {
    first_name: string | null
    last_name: string | null
    email: string | null
    phone_primary: string | null
    phone_secondary: string | null
  } | null
}

// M6: guardians.address_* dropnuto → matrika dává už jen jméno/kontakt,
// adresa přichází z addresses (overlayAddr) nebo z enrollmentu.
function rodicZLinku(link: GuardianRow | undefined): SmlouvaRodic | null {
  if (!link?.guardians) return null
  const g = link.guardians
  return {
    jmeno: [g.first_name, g.last_name].filter(Boolean).join(' ') || null,
    bydliste: null,
    psc: null,
    email: g.email ?? null,
    telefon: g.phone_primary ?? g.phone_secondary ?? null,
  }
}

// Plná jednořádková adresa „ulice číslo, PSČ obec".
function adresaPlna(
  ulice: string | null,
  cislo: string | null,
  psc: string | null,
  obec: string | null,
): string | null {
  const r1 = [ulice, cislo].filter(Boolean).join(' ')
  const r2 = [psc, obec].filter(Boolean).join(' ')
  return [r1, r2].filter((p) => p.length > 0).join(', ') || null
}

type EnrollmentGuardianRow = {
  pribuzensky_vztah: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  telefon: string | null
  address_ulice: string | null
  address_cislo: string | null
  address_obec: string | null
  address_psc: string | null
}

// Rodič z přijímací žádosti (enrollment) — zde je validovaná adresa, kterou
// migrace do guardians nemusela přenést (adresa zástupce je v enrollmentu
// nepovinná).
function rodicZEnrollment(g: EnrollmentGuardianRow | undefined): SmlouvaRodic | null {
  if (!g) return null
  return {
    jmeno: [g.first_name, g.last_name].filter(Boolean).join(' ') || null,
    bydliste: [g.address_ulice, g.address_cislo].filter(Boolean).join(' ') || null,
    psc: g.address_psc ?? null,
    email: g.email ?? null,
    telefon: g.telefon ?? null,
  }
}

// Ze dvou zdrojů vyber ten s vyplněnou adresou (jinak cokoli je k dispozici).
function preferSAdresou(a: SmlouvaRodic | null, b: SmlouvaRodic | null): SmlouvaRodic | null {
  if (a?.bydliste) return a
  if (b?.bydliste) return b
  return a ?? b
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((staffRaw as { role?: string } | null)?.role !== 'director') {
    return NextResponse.json({ error: 'Smlouvu může vygenerovat jen ředitel.' }, { status: 403 })
  }

  // žák
  const { data: s } = await supabase
    .from('students')
    .select('first_name, last_name, birth_number, birth_date, birth_place, health_insurance_code')
    .eq('id', id)
    .maybeSingle()
  if (!s) return NextResponse.json({ error: 'Žák nenalezen.' }, { status: 404 })
  const student = s as Record<string, string | null>

  // zákonní zástupci (mapování otec/matka dle role; primární kontakt první)
  const { data: gl } = await supabase
    .from('student_guardian_links')
    .select(
      `role, je_primarni_kontakt, guardian_id,
       guardians(first_name, last_name, email, phone_primary, phone_secondary)`,
    )
    .eq('student_id', id)
    .eq('je_zakonny_zastupce', true)
    .is('platnost_do', null)
    .order('je_primarni_kontakt', { ascending: false })
  const links = (gl as GuardianRow[] | null) ?? []

  const otecM = rodicZLinku(links.find((l) => l.role === 'otec'))
  const matkaM = rodicZLinku(links.find((l) => l.role === 'matka'))

  // Přijímací žádost (pokud žák vznikl přijetím) — validované adresy: trvalé
  // bydliště dítěte je povinné a do students se neukládá (jen obec/okres kód),
  // adresy zástupců zde bývají úplnější než v guardians.
  const { data: appRow } = await supabase
    .from('enrollment_applications')
    .select(
      'id, dite_trvale_bydliste_ulice, dite_trvale_bydliste_cislo, dite_trvale_bydliste_psc, dite_trvale_bydliste_obec',
    )
    .eq('student_id', id)
    .maybeSingle()

  let otecE: SmlouvaRodic | null = null
  let matkaE: SmlouvaRodic | null = null
  let bydlisteZakaE: string | null = null
  if (appRow) {
    const a = appRow as { id: string } & Record<string, string | null>
    bydlisteZakaE = adresaPlna(
      a.dite_trvale_bydliste_ulice,
      a.dite_trvale_bydliste_cislo,
      a.dite_trvale_bydliste_psc,
      a.dite_trvale_bydliste_obec,
    )
    const { data: egs } = await supabase
      .from('enrollment_guardians')
      .select(
        'pribuzensky_vztah, first_name, last_name, email, telefon, address_ulice, address_cislo, address_obec, address_psc',
      )
      .eq('application_id', a.id)
    const eg = (egs as EnrollmentGuardianRow[] | null) ?? []
    otecE = rodicZEnrollment(eg.find((g) => g.pribuzensky_vztah === 'otec'))
    matkaE = rodicZEnrollment(eg.find((g) => g.pribuzensky_vztah === 'matka'))
  }

  // Jednotný adresní model (M3): addresses = nejvyšší priorita, pak enrollment,
  // pak matrika (guardians). Jméno/kontakt rodiče zůstává z enrollment/matriky,
  // z addresses se přebírá jen adresa (trvalé bydliště).
  const otecGid = links.find((l) => l.role === 'otec')?.guardian_id ?? null
  const matkaGid = links.find((l) => l.role === 'matka')?.guardian_id ?? null

  const studAddr = await getStudentAddresses(supabase, id)
  const guardAddr = await getGuardianAddresses(
    supabase,
    [otecGid, matkaGid].filter((x): x is string => !!x),
  )

  const overlayAddr = (r: SmlouvaRodic | null, a: AddressRow | null): SmlouvaRodic | null => {
    if (!r || !a) return r
    return { ...r, bydliste: formatStreet(a) ?? r.bydliste, psc: a.psc ?? r.psc }
  }

  const otec = overlayAddr(preferSAdresou(otecE, otecM), otecGid ? guardAddr.get(otecGid)?.trvale ?? null : null)
  const matka = overlayAddr(preferSAdresou(matkaE, matkaM), matkaGid ? guardAddr.get(matkaGid)?.trvale ?? null : null)
  const bydlisteZaka = formatAddressLine(studAddr.trvale) ?? bydlisteZakaE

  // nástupní ročník (matrika) → počet zbývajících ročníků (budoucí prvňák 9)
  const { data: edu } = await supabase
    .from('student_education_mode')
    .select('rocnik')
    .eq('student_id', id)
    .order('valid_from', { ascending: true })
    .limit(1)
    .maybeSingle()
  const nastupniRocnik = (edu as { rocnik?: number } | null)?.rocnik ?? 1
  const pocetRocnikuDefault = Math.min(Math.max(10 - nastupniRocnik, 1), 9)

  // počáteční školní rok = nejstarší zařazení do třídy
  const { data: mem } = await supabase
    .from('group_memberships')
    .select('school_year')
    .eq('student_id', id)
    .order('valid_from', { ascending: true })
    .limit(1)
    .maybeSingle()
  const skolniRokDefault = (mem as { school_year?: string } | null)?.school_year ?? ''

  // overrides z formuláře
  const sp = request.nextUrl.searchParams
  const pocetRocniku = Number(sp.get('rocniky')) || pocetRocnikuDefault
  const odSkolnihoRoku = sp.get('skolniRok') || skolniRokDefault
  const skolneKc = Number(sp.get('skolne')) || DEFAULT_SKOLNE

  const data: StudijniSmlouvaData = {
    zak: {
      jmeno: student.first_name ?? '',
      prijmeni: student.last_name ?? '',
      rodne_cislo: student.birth_number,
      datum_narozeni: student.birth_date,
      misto_narozeni: student.birth_place,
      bydliste: bydlisteZaka,
      pojistovna_kod: student.health_insurance_code,
    },
    otec,
    matka,
    pocet_rocniku: pocetRocniku,
    od_skolniho_roku: odSkolnihoRoku,
    skolne_kc: skolneKc,
  }

  let pdf: Buffer
  try {
    pdf = await renderStudijniSmlouvaPdf(data)
  } catch (e) {
    console.error('[studijni-smlouva] render:', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  const filename = `studijni-smlouva_${asciiSlug(student.last_name ?? '')}_${asciiSlug(student.first_name ?? '')}.pdf`
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
