// app/dashboard/zapis/[id]/dokument/[druh]/route.ts
// Generování PDF dokumentů přijímacího case. Guard: ředitel.
//  - GET  … oznámení (adresát školy v query)
//  - POST … rozhodnutí a usnesení (delší volný text odůvodnění → tělo requestu)
// Data z enrollment_applications + enrollment_guardians (vlastník = adresát ZZ)
// + poslední rozhodnutí; č.j. rozhodnutí z eSSL dokumentu (decision.dokument_id).
// F1: on-the-fly, deterministicky. Storage kopie + navázání na eSSL = F2.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getEnrollmentApplicationDetail } from '@/lib/enrollment/dashboard-queries'
import {
  dostupneDokumenty,
  predRozhodnutimDokumenty,
  jeDokumentDruh,
  oznameniKindZDokumentu,
  dokumentNabidka,
  DOKUMENT_LABELS,
  type EnrollmentDokumentDruh,
} from '@/lib/enrollment/dokumenty'
import { adresaZaka, fmtDate } from '@/lib/enrollment/pdf/layout'
import { renderOznameniPdf } from '@/lib/enrollment/pdf/oznameni'
import { renderOdkladRozhodnutiPdf, renderPreruseniUsneseniPdf } from '@/lib/enrollment/pdf/odklad'
import { renderNeprijetiPdf } from '@/lib/enrollment/pdf/neprijeti'
import { renderPrijetiPdf } from '@/lib/enrollment/pdf/prijeti'
import {
  renderPrestupZamitnutPdf,
  renderZastaveniPdf,
  type ZastaveniDuvod,
} from '@/lib/enrollment/pdf/zamitnuti-zastaveni'
import type { EnrollmentRozhodnuti } from '@/lib/enrollment/rozhodnuti'
import type { EnrollmentApplicationDetail } from '@/lib/enrollment/dashboard-queries'

// react-pdf potřebuje Node runtime (ne edge).
export const runtime = 'nodejs'

/** Bezpečný ASCII základ názvu souboru. */
function asciiSlug(str: string): string {
  return (
    str
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'dokument'
  )
}

interface OwnerGuardian {
  first_name: string | null
  last_name: string | null
  address_ulice: string | null
  address_cislo: string | null
  address_psc: string | null
  address_obec: string | null
}

interface LatestDecision {
  rozhodnuti: EnrollmentRozhodnuti | null
  duvod: string | null
  cilovy_school_year: string | null
  datum_nastupu: string | null
  created_at: string | null
  dokument_id: string | null
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

function jmeno(g: OwnerGuardian | null): string {
  if (!g) return ''
  return [g.first_name, g.last_name].filter(Boolean).join(' ').trim()
}

function zzAdresaRadky(g: OwnerGuardian | null): string[] {
  if (!g) return []
  const l1 = [g.address_ulice, g.address_cislo].filter(Boolean).join(' ')
  const l2 = [g.address_psc, g.address_obec].filter(Boolean).join(' ')
  return [l1, l2].filter((r) => r.length > 0)
}

async function nactiVlastnika(supabase: Supabase, applicationId: string): Promise<OwnerGuardian | null> {
  const { data } = await supabase
    .from('enrollment_guardians')
    .select('first_name, last_name, address_ulice, address_cislo, address_psc, address_obec')
    .eq('application_id', applicationId)
    .eq('role_v_zadosti', 'vlastnik')
    .maybeSingle()
  return (data as OwnerGuardian | null) ?? null
}

async function nactiPosledniRozhodnuti(
  supabase: Supabase,
  applicationId: string,
): Promise<LatestDecision | null> {
  const { data } = await supabase
    .from('enrollment_decisions')
    .select('rozhodnuti, duvod, cilovy_school_year, datum_nastupu, created_at, dokument_id')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as LatestDecision | null) ?? null
}

async function cisloJednaciDokumentu(supabase: Supabase, dokumentId: string): Promise<string | null> {
  const { data } = await supabase
    .from('dokumenty')
    .select('cislo_jednaci')
    .eq('id', dokumentId)
    .maybeSingle()
  return (data as { cislo_jednaci?: string } | null)?.cislo_jednaci ?? null
}

async function spisovaZnacka(supabase: Supabase, spisId: string): Promise<string | null> {
  const { data } = await supabase
    .from('spisy')
    .select('spisova_znacka')
    .eq('id', spisId)
    .maybeSingle()
  return (data as { spisova_znacka?: string } | null)?.spisova_znacka ?? null
}

// ── Společná příprava + guard ────────────────────────────────────────────

interface Priprava {
  supabase: Supabase
  app: EnrollmentApplicationDetail
  posledni: LatestDecision | null
  nabidka: ReturnType<typeof dokumentNabidka>
}

async function pripravit(
  id: string,
  druh: EnrollmentDokumentDruh,
): Promise<Priprava | NextResponse> {
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
    return NextResponse.json({ error: 'Dokument může vygenerovat jen ředitel.' }, { status: 403 })
  }

  const app = await getEnrollmentApplicationDetail(id)
  if (!app) return NextResponse.json({ error: 'Žádost nenalezena.' }, { status: 404 })

  const posledni = await nactiPosledniRozhodnuti(supabase, id)
  const rozhodnuti = posledni?.rozhodnuti ?? null

  // Dokument musí být pro daný case k dispozici — buď dle posledního
  // rozhodnutí, nebo (přerušení) jako pre-rozhodnutí dokument.
  const povoleno =
    dostupneDokumenty(app.typ, rozhodnuti).some((n) => n.druh === druh) ||
    predRozhodnutimDokumenty(app.typ, app.stav).some((n) => n.druh === druh)
  if (!povoleno) {
    return NextResponse.json(
      { error: 'Tento dokument není pro aktuální stav žádosti k dispozici.' },
      { status: 409 },
    )
  }

  return { supabase, app, posledni, nabidka: dokumentNabidka(druh) }
}

function pdfOdpoved(pdf: Buffer, app: EnrollmentApplicationDetail, druh: EnrollmentDokumentDruh) {
  const filename = `${asciiSlug(DOKUMENT_LABELS[druh])}_${asciiSlug(app.dite_prijmeni)}_${asciiSlug(app.dite_jmeno)}.pdf`
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ── GET: oznámení školám (adresát v query) ───────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; druh: string }> },
) {
  const { id, druh } = await params
  if (!jeDokumentDruh(druh)) {
    return NextResponse.json({ error: 'Neznámý druh dokumentu.' }, { status: 404 })
  }

  const prep = await pripravit(id, druh)
  if (prep instanceof NextResponse) return prep
  const { app, posledni, nabidka } = prep

  const oznameniKind = oznameniKindZDokumentu(druh)
  if (nabidka.metoda !== 'GET' || !oznameniKind) {
    return NextResponse.json(
      { error: 'Tento dokument se generuje přes formulář (POST).' },
      { status: 405 },
    )
  }

  const bydliste = adresaZaka(
    app.dite_trvale_bydliste_ulice,
    app.dite_trvale_bydliste_cislo,
    app.dite_trvale_bydliste_psc,
    app.dite_trvale_bydliste_obec,
  )

  let pdf: Buffer
  try {
    const sp = request.nextUrl.searchParams
    pdf = await renderOznameniPdf(oznameniKind, {
      jmeno: app.dite_jmeno,
      prijmeni: app.dite_prijmeni,
      rodne_cislo: app.rodne_cislo,
      bydliste,
      datum_nastupu: posledni?.datum_nastupu ? fmtDate(posledni.datum_nastupu) : null,
      datum_dokumentu: posledni?.created_at ?? null,
      adresat_skola: sp.get('skola') ?? '',
      adresat_reditel: sp.get('reditel') ?? '',
      osloveni: sp.get('osloveni') ?? 'Vážená paní ředitelko',
    })
  } catch (e) {
    console.error('[zapis] render PDF (GET):', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  return pdfOdpoved(pdf, app, druh)
}

// ── POST: rozhodnutí o odkladu + usnesení o přerušení (vstup v těle) ─────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; druh: string }> },
) {
  const { id, druh } = await params
  if (!jeDokumentDruh(druh)) {
    return NextResponse.json({ error: 'Neznámý druh dokumentu.' }, { status: 404 })
  }

  const prep = await pripravit(id, druh)
  if (prep instanceof NextResponse) return prep
  const { supabase, app, posledni, nabidka } = prep

  if (nabidka.metoda !== 'POST') {
    return NextResponse.json({ error: 'Tento dokument se stahuje přímo (GET).' }, { status: 405 })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const owner = await nactiVlastnika(supabase, id)

  const diteAdresa = adresaZaka(
    app.dite_trvale_bydliste_ulice,
    app.dite_trvale_bydliste_cislo,
    app.dite_trvale_bydliste_psc,
    app.dite_trvale_bydliste_obec,
  )
  const zaklad = {
    zz_jmeno: jmeno(owner),
    zz_adresa_radky: zzAdresaRadky(owner),
    dite_jmeno: `${app.dite_jmeno} ${app.dite_prijmeni}`.trim(),
    dite_narozeni: app.datum_narozeni,
    dite_rodne_cislo: app.rodne_cislo,
    dite_adresa: diteAdresa,
  }

  let pdf: Buffer
  try {
    if (druh === 'usneseni-preruseni') {
      pdf = await renderPreruseniUsneseniPdf({
        ...zaklad,
        cislo_jednaci: (body.cislo_jednaci as string) || null,
        datum_vydani: (body.datum_vydani as string) || new Date().toISOString(),
        datum_zadosti: (body.datum_zadosti as string) || null,
        lhuta_dnu: Number(body.lhuta_dnu) || 30,
      })
    } else if (druh === 'rozhodnuti-prijeti') {
      const cj = posledni?.dokument_id
        ? await cisloJednaciDokumentu(supabase, posledni.dokument_id)
        : null
      const znacka = app.spis_id ? await spisovaZnacka(supabase, app.spis_id) : null
      pdf = await renderPrijetiPdf({
        zz_jmeno: zaklad.zz_jmeno,
        zz_adresa_radky: zaklad.zz_adresa_radky,
        zz_adresa_doruceni: zzAdresaRadky(owner).join(', '),
        dite_jmeno: zaklad.dite_jmeno,
        dite_narozeni: zaklad.dite_narozeni,
        dite_adresa: zaklad.dite_adresa,
        cislo_jednaci: cj,
        spisova_znacka: znacka,
        datum_vydani: posledni?.created_at ?? new Date().toISOString(),
        skolni_rok: (body.skolni_rok as string) || posledni?.cilovy_school_year || '',
        oduvodneni: (body.oduvodneni as string) || '',
      })
    } else if (druh === 'rozhodnuti-neprijeti') {
      const cj = posledni?.dokument_id
        ? await cisloJednaciDokumentu(supabase, posledni.dokument_id)
        : null
      const znacka = app.spis_id ? await spisovaZnacka(supabase, app.spis_id) : null
      pdf = await renderNeprijetiPdf({
        zz_jmeno: zaklad.zz_jmeno,
        zz_adresa_radky: zaklad.zz_adresa_radky,
        zz_adresa_doruceni: zzAdresaRadky(owner).join(', '),
        dite_jmeno: zaklad.dite_jmeno,
        dite_narozeni: zaklad.dite_narozeni,
        dite_adresa: zaklad.dite_adresa,
        cislo_jednaci: cj,
        spisova_znacka: znacka,
        datum_vydani: posledni?.created_at ?? new Date().toISOString(),
        skolni_rok: (body.skolni_rok as string) || posledni?.cilovy_school_year || '',
        oduvodneni: (body.oduvodneni as string) || '',
        prilohy: (body.prilohy as string) || 'žádné',
      })
    } else if (druh === 'rozhodnuti-odklad') {
      // Č.j. z eSSL dokumentu rozhodnutí; datum vydání = datum rozhodnutí.
      const cj = posledni?.dokument_id
        ? await cisloJednaciDokumentu(supabase, posledni.dokument_id)
        : null
      pdf = await renderOdkladRozhodnutiPdf({
        ...zaklad,
        zz_adresa_pobyt: zzAdresaRadky(owner).join(', '),
        cislo_jednaci: cj,
        datum_vydani: posledni?.created_at ?? new Date().toISOString(),
        cilovy_skolni_rok: (body.cilovy_skolni_rok as string) || posledni?.cilovy_school_year || '',
        datum_nastupu_text:
          (body.datum_nastupu_text as string) ||
          (posledni?.datum_nastupu ? fmtDate(posledni.datum_nastupu) : ''),
        oduvodneni: (body.oduvodneni as string) || '',
        prilohy: (body.prilohy as string) || '',
        skartacni_znak: (body.skartacni_znak as string) || 'S-10 (uchování po dobu 10 let)',
      })
    } else if (druh === 'rozhodnuti-prestup-zamitnut') {
      const cj = posledni?.dokument_id
        ? await cisloJednaciDokumentu(supabase, posledni.dokument_id)
        : null
      const znacka = app.spis_id ? await spisovaZnacka(supabase, app.spis_id) : null
      pdf = await renderPrestupZamitnutPdf({
        zz_jmeno: zaklad.zz_jmeno,
        zz_adresa_radky: zaklad.zz_adresa_radky,
        zz_adresa_doruceni: zzAdresaRadky(owner).join(', '),
        dite_jmeno: zaklad.dite_jmeno,
        dite_narozeni: zaklad.dite_narozeni,
        dite_adresa: zaklad.dite_adresa,
        cislo_jednaci: cj,
        spisova_znacka: znacka,
        datum_vydani: posledni?.created_at ?? new Date().toISOString(),
        prestup_k_datu: (body.prestup_k_datu as string) || (app.prestup_k_datu ? fmtDate(app.prestup_k_datu) : ''),
        oduvodneni: (body.oduvodneni as string) || '',
      })
    } else if (druh === 'usneseni-zastaveni') {
      const cj = posledni?.dokument_id
        ? await cisloJednaciDokumentu(supabase, posledni.dokument_id)
        : null
      const duvod: ZastaveniDuvod = body.duvod === 'bezpredmetna' ? 'bezpredmetna' : 'zpetvzeti'
      pdf = await renderZastaveniPdf({
        typ: app.typ,
        zz_jmeno: zaklad.zz_jmeno,
        zz_adresa_radky: zaklad.zz_adresa_radky,
        dite_jmeno: zaklad.dite_jmeno,
        dite_narozeni: zaklad.dite_narozeni,
        cislo_jednaci: cj,
        datum_vydani: posledni?.created_at ?? new Date().toISOString(),
        skolni_rok: (body.skolni_rok as string) || posledni?.cilovy_school_year || '',
        duvod,
        datum_udalosti: (body.datum_udalosti as string) || null,
        oduvodneni: (body.oduvodneni as string) || '',
      })
    } else {
      return NextResponse.json({ error: 'Neznámý druh dokumentu.' }, { status: 404 })
    }
  } catch (e) {
    console.error('[zapis] render PDF (POST):', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  return pdfOdpoved(pdf, app, druh)
}
