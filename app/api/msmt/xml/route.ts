/**
 * app/api/msmt/xml/route.ts
 *
 * GET /api/msmt/xml?type=01&year=2025%2F2026[&rdat=15.04.2026]
 *
 * Parametry:
 *   type  — '01' (základní) | '01a' (SVP) | default: '01'
 *   year  — školní rok, default: '2025/2026'
 *   rdat  — referenční datum DD.MM.YYYY, default: dnes
 *
 * Výstup: windows-1250 XML, Content-Disposition: attachment
 *
 * Prerekvizity (env):
 *   MSMT_IZO          — IZO školy (povinné), např. '250002639'
 *   MSMT_RED_IZO      — IZO právního subjektu (default = MSMT_IZO)
 *   MSMT_DRUH_SKOLY   — default 'B00'
 *   MSMT_TYP_SKOLY    — default '2'
 *
 * Závislost: npm install iconv-lite
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  generateZakladni,
  generateSouborA,
  StudentZakladni,
  StudentMatrikaA,
  XmlConfig,
} from '@/lib/msmt-xml'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'

// Explicitně Node.js runtime — iconv-lite není kompatibilní s Edge
export const runtime = 'nodejs'

// ---------------------------------------------------------------------------
// Konverze na windows-1250
// ---------------------------------------------------------------------------

async function toWin1250(utf8string: string): Promise<Uint8Array> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iconv = require('iconv-lite') as typeof import('iconv-lite')
    const buf = iconv.encode(utf8string, 'win1250')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    console.error('[msmt/xml] iconv-lite není nainstalováno.')
    return new TextEncoder().encode(utf8string)
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  // --- Auth: pouze director ---
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 })
  }
  const { data: staff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .single()
  if (staff?.role !== 'director') {
    return NextResponse.json({ error: 'Přístup zamítnut' }, { status: 403 })
  }

  // --- Parametry ---
  const sp   = request.nextUrl.searchParams
  const type = sp.get('type') ?? '01'
  const year = sp.get('year') ?? CURRENT_SCHOOL_YEAR
  const rdatParam = sp.get('rdat') // DD.MM.YYYY

  const izo = process.env.MSMT_IZO ?? ''
  if (!izo) {
    return NextResponse.json(
      { error: 'Env proměnná MSMT_IZO není nastavena (Vercel → Settings → Environment Variables)' },
      { status: 500 },
    )
  }

  // Parsování RDAT
  let rdat: Date
  if (rdatParam) {
    const [dd, mm, yyyy] = rdatParam.split('.').map(Number)
    rdat = new Date(yyyy, mm - 1, dd, 12)
  } else {
    rdat = new Date()
  }

  const cfg: XmlConfig = {
    izo,
    red_izo:    process.env.MSMT_RED_IZO    ?? izo,
    druh_skoly: process.env.MSMT_DRUH_SKOLY ?? 'B00',
    typ_skoly:  process.env.MSMT_TYP_SKOLY  ?? '2',
    rdat,
    school_year: year,
  }

  // ---------------------------------------------------------------------------
  // Typ 01 — základní soubor
  // ---------------------------------------------------------------------------
  if (type === '01') {
    const { data: raw, error } = await supabase
      .from('students')
      .select(`
        id,
        kod_zaka_msmt,
        enrollment_date,
        withdrawal_date,
        citizenship,
        obec_bydliste_kod,
        okres_bydliste_kod,
        predchozi_skola_izo,
        predchozi_vzdelavani,
        kod_zahajeni,
        delka_programu,
        cizi_jazyky,
        zdroj_financovani,
        sp_obvod,
        student_education_mode ( zpusob, valid_from, valid_to ),
        semester_attendance_summary ( oml_h, neoml_h, semester, school_year, locked_at )
      `)
      .eq('status', 'active')
      .not('kod_zaka_msmt', 'is', null)
      .order('kod_zaka_msmt', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const students: StudentZakladni[] = (raw ?? []).map((s) => {
      // Nejnovější platný education_mode záznam
      const modes = (
        Array.isArray(s.student_education_mode)
          ? s.student_education_mode
          : s.student_education_mode
          ? [s.student_education_mode]
          : []
      ) as Array<{ zpusob: string; valid_from: string; valid_to: string | null }>

      const latestMode = modes
        .slice()
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]

      // semester_attendance_summary — semester 1 pro daný rok
      const summaries = (
        Array.isArray(s.semester_attendance_summary)
          ? s.semester_attendance_summary
          : s.semester_attendance_summary
          ? [s.semester_attendance_summary]
          : []
      ) as Array<{
        oml_h: number | null
        neoml_h: number | null
        semester: number
        school_year: string
        locked_at: string | null
      }>

      const sas1 = summaries.find(
        (x) => x.school_year === year && x.semester === 1,
      )

      return {
        kod_zaka_msmt:        s.kod_zaka_msmt as string,
        enrollment_date:      s.enrollment_date,
        withdrawal_date:      s.withdrawal_date,
        citizenship:          s.citizenship,
        obec_bydliste_kod:    s.obec_bydliste_kod,
        okres_bydliste_kod:   s.okres_bydliste_kod,
        predchozi_skola_izo:  s.predchozi_skola_izo,
        predchozi_vzdelavani: s.predchozi_vzdelavani,
        kod_zahajeni:         s.kod_zahajeni,
        delka_programu:       s.delka_programu,
        cizi_jazyky:          s.cizi_jazyky as any,
        zdroj_financovani:    s.zdroj_financovani,
        sp_obvod:             s.sp_obvod,
        zpusob:               latestMode?.zpusob ?? '11',
        oml_h:                sas1?.oml_h   ?? null,
        neoml_h:              sas1?.neoml_h ?? null,
      }
    })

    const xmlStr = generateZakladni(students, cfg)
    const encoded = await toWin1250(xmlStr)

    return new NextResponse(encoded.buffer as ArrayBuffer, {
      headers: {
        'Content-Type':        'application/xml; charset=windows-1250',
        'Content-Disposition': `attachment; filename="Z${izo}_01.xml"`,
        'Content-Length':      String(encoded.length),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Typ 01a — soubor „a" (SVP)
  // ---------------------------------------------------------------------------
  if (type === '01a') {
    const { data: raw, error } = await supabase
      .from('students')
      .select(`
        id,
        kod_zaka_msmt,
        enrollment_date,
        withdrawal_date,
        student_matrika_a (
          pspo, indi, nadani, id_znev,
          uvp, prodl_dv, upr_vyst, typ_tr,
          sz, zz, zvj, jaz_podp, jaz_prip,
          valid_from, valid_to
        )
      `)
      .eq('status', 'active')
      .eq('has_svp', true)
      .not('kod_zaka_msmt', 'is', null)
      .order('kod_zaka_msmt', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const students: StudentMatrikaA[] = (raw ?? []).flatMap((s) => {
      const records = (
        Array.isArray(s.student_matrika_a)
          ? s.student_matrika_a
          : s.student_matrika_a
          ? [s.student_matrika_a]
          : []
      ) as Array<{
        pspo: number; indi: string | null; nadani: string | null
        id_znev: string | null; uvp: boolean; prodl_dv: boolean
        upr_vyst: boolean; typ_tr: string; sz: string; zz: string
        zvj: string | null; jaz_podp: boolean; jaz_prip: boolean
        valid_from: string; valid_to: string | null
      }>

      // Nejnovější záznam
      const latest = records
        .slice()
        .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]

      // Přeskočit pokud není záznam nebo pspo = 0 (čeká na PPP)
      if (!latest || latest.pspo === 0) return []

      return [{
        kod_zaka_msmt:   s.kod_zaka_msmt as string,
        enrollment_date: s.enrollment_date,
        withdrawal_date: s.withdrawal_date,
        pspo:     latest.pspo,
        indi:     latest.indi,
        nadani:   latest.nadani,
        id_znev:  latest.id_znev,
        uvp:      latest.uvp     ?? false,
        prodl_dv: latest.prodl_dv ?? false,
        upr_vyst: latest.upr_vyst ?? false,
        typ_tr:   latest.typ_tr  ?? '100A0',
        sz:       latest.sz      ?? '0',
        zz:       latest.zz      ?? '0',
        zvj:      latest.zvj,
        jaz_podp: latest.jaz_podp ?? false,
        jaz_prip: latest.jaz_prip ?? false,
      } satisfies StudentMatrikaA]
    })

    const xmlStr = generateSouborA(students, cfg)
    const encoded = await toWin1250(xmlStr)

    return new NextResponse(encoded.buffer as ArrayBuffer, {
      headers: {
        'Content-Type':        'application/xml; charset=windows-1250',
        'Content-Disposition': `attachment; filename="Z${izo}_01a.xml"`,
        'Content-Length':      String(encoded.length),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Typ 01b — zaměstnanci (TODO — pouze podzimní sběr)
  // ---------------------------------------------------------------------------
  return NextResponse.json(
    { error: `Typ '${type}' není implementován. Soubor 'b' (zaměstnanci) je plánován pro podzimní sběr.` },
    { status: 400 },
  )
}
