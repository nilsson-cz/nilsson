/**
 * app/api/msmt/xml/route.ts
 *
 * GET /api/msmt/xml?type=01&sber=podzimni-2026
 *
 * Parametry:
 *   type  — '01' (základní) | '01a' (žáci s PO) | default: '01'
 *   sber  — 'jarni-RRRR' (RDAT 31. 3.) | 'podzimni-RRRR' (RDAT 30. 9.);
 *           default: nejbližší rozhodné datum (lib/msmt-sber.ts)
 *
 * Žáci: všichni, jejichž docházka zasahuje do období sběru (i odešlí).
 * OML_H/NEOML_H: jaro = 1. pololetí aktuálního roku, podzim = 2. pololetí
 * předchozího roku; + hodiny z předchozí školy (transfer_hours_*), metodika
 * MŠMT je při přestupu sčítá.
 *
 * Formát a položky: lib/msmt-xml.ts (ZS.025). Chybí-li v IS povinný údaj,
 * vrací 422 se seznamem — neúplný soubor se nevydá.
 *
 * Env: MSMT_IZO (povinné), MSMT_TELEFON (hlavička, volitelné).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  generateZakladni,
  generateSouborA,
  chybejiciPolozky,
  type ZakMatrika,
  type ZakMatrikaA,
  type MatrikaAObdobi,
  type CiziJazyk,
  type XmlConfig,
} from '@/lib/msmt-xml'
import { zkontrolujRodneCislo } from '@/lib/rodne-cislo'
import { parseSber } from '@/lib/msmt-sber'
import { msmtEnv } from '@/lib/msmt-env'

// Explicitně Node.js runtime — iconv-lite není kompatibilní s Edge
export const runtime = 'nodejs'

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

function xmlResponse(xml: Uint8Array, filename: string) {
  return new NextResponse(xml.buffer as ArrayBuffer, {
    headers: {
      'Content-Type':        'application/xml; charset=windows-1250',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(xml.length),
    },
  })
}

type StudentRow = {
  id: string; first_name: string; last_name: string; kod_zaka: string
  kod_zaka_msmt: string | null; birth_number: string | null; birth_date: string
  enrollment_date: string; withdrawal_date: string | null; citizenship: string | null
  obec_bydliste_kod: string | null; okres_bydliste_kod: string | null
  msmt_odhl: string | null; msmt_izop: string | null; kod_zahajeni: string | null
  delka_programu: number | null; cizi_jazyky: unknown; zdroj_financovani: string | null
  sp_obvod: string | null; has_svp: boolean
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  // --- Auth: pouze director ---
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 })
  const { data: staff } = await supabase
    .from('staff')
    .select('role, first_name, last_name, email')
    .eq('user_id', user.id)
    .single()
  if (staff?.role !== 'director') {
    return NextResponse.json({ error: 'Přístup zamítnut' }, { status: 403 })
  }

  // --- Parametry ---
  const sp   = request.nextUrl.searchParams
  const type = sp.get('type') ?? '01'
  const sber = parseSber(sp.get('sber'))
  if (type !== '01' && type !== '01a') {
    return NextResponse.json(
      { error: `Typ '${type}' není implementován. Soubor 'b' (podpůrná opatření, jen podzim) zatím není hotový.` },
      { status: 400 },
    )
  }

  const env = msmtEnv()
  if (!env.izo) {
    return NextResponse.json(
      { error: 'Env proměnná MSMT_IZO není nastavena (Vercel → Settings → Environment Variables)' },
      { status: 500 },
    )
  }

  const cfg: XmlConfig = {
    izo: env.izo,
    sber,
    hlavicka: {
      autor: `${staff.first_name} ${staff.last_name}`.trim(),
      telefon: env.telefon,
      email: staff.email,
      vytvoreno: new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' })),
    },
  }

  // --- Žáci v období sběru (vč. odešlých) ---
  // ODHL/IZOP z msmt_odhl / msmt_izop (migrace 130) — predchozi_vzdelavani je
  // volná poznámka, predchozi_skola_izo obsahuje název školy ze zápisu.
  const { data: students, error } = await supabase
    .from('students')
    .select(`
      id, first_name, last_name, kod_zaka, kod_zaka_msmt, birth_number, birth_date,
      enrollment_date, withdrawal_date, citizenship, obec_bydliste_kod,
      okres_bydliste_kod, msmt_odhl, msmt_izop, kod_zahajeni,
      delka_programu, cizi_jazyky, zdroj_financovani, sp_obvod, has_svp
    `)
    .in('status', ['active', 'withdrawn'])
    .lte('enrollment_date', sber.obdobiDo)
    .or(`withdrawal_date.is.null,withdrawal_date.gte.${sber.obdobiOd}`)
    .order('kod_zaka', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const ids = ((students ?? []) as StudentRow[]).map((s) => s.id)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'V období sběru nejsou žádní žáci.' }, { status: 422 })
  }

  // --- Související data (bez PostgREST embed) ---
  const [modes, memberships, summaries] = await Promise.all([
    supabase.from('student_education_mode')
      .select('student_id, rocnik, zpusob, valid_from, valid_to')
      .in('student_id', ids),
    supabase.from('group_memberships')
      .select('student_id, group_id, valid_from, valid_to')
      .in('student_id', ids),
    supabase.from('semester_attendance_summary')
      .select('student_id, oml_h, neoml_h, transfer_hours_oml, transfer_hours_neoml')
      .eq('school_year', sber.omlSkolniRok)
      .eq('semester', sber.omlPololeti)
      .in('student_id', ids),
  ])
  for (const r of [modes, memberships, summaries]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }
  const groupIds = [...new Set((memberships.data ?? []).map((m) => m.group_id))]
  const { data: groups, error: gErr } = groupIds.length
    ? await supabase.from('groups').select('id, name').in('id', groupIds)
    : { data: [] as { id: string; name: string }[], error: null }
  if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]))

  // --- Sestavení žáků ---
  const zaci: (ZakMatrika & { id: string; jmeno: string })[] = []
  const chyby: string[] = []
  for (const s of (students ?? []) as StudentRow[]) {
    const jmeno = `${s.last_name} ${s.first_name}`
    const rc = zkontrolujRodneCislo(s.birth_number)
    if (rc.stav !== 'ok') {
      chyby.push(`${jmeno}: neplatné nebo chybějící rodné číslo`)
      continue
    }
    const sas = (summaries.data ?? []).find((x) => x.student_id === s.id)
    const z: ZakMatrika & { id: string; jmeno: string } = {
      id: s.id,
      jmeno,
      rodc: rc.rodc as string,
      kod_zaka_msmt: s.kod_zaka_msmt,
      birth_date: s.birth_date,
      citizenship: s.citizenship,
      obec_kod: s.obec_bydliste_kod,
      okres_kod: s.okres_bydliste_kod,
      sp_obvod: s.sp_obvod,
      odhl: s.msmt_odhl,
      izop: s.msmt_izop,
      enrollment_date: s.enrollment_date,
      kod_zahajeni: s.kod_zahajeni,
      withdrawal_date: s.withdrawal_date,
      zdroj_financovani: s.zdroj_financovani,
      delka_programu: s.delka_programu,
      cizi_jazyky: (s.cizi_jazyky as unknown as CiziJazyk[] | null) ?? null,
      rocniky: (modes.data ?? []).filter((m) => m.student_id === s.id).map((m) => ({
        od: m.valid_from, do: m.valid_to, rocnik: m.rocnik, zpusob: m.zpusob,
      })),
      tridy: (memberships.data ?? []).filter((m) => m.student_id === s.id).map((m) => ({
        od: m.valid_from, do: m.valid_to, nazev: groupName.get(m.group_id) ?? '',
      })).filter((t) => t.nazev),
      // NULL (nespočteno) zůstává NULL; jinak + hodiny z předchozí školy.
      oml_h:   sas?.oml_h   == null ? null : sas.oml_h   + (sas.transfer_hours_oml   ?? 0),
      neoml_h: sas?.neoml_h == null ? null : sas.neoml_h + (sas.transfer_hours_neoml ?? 0),
    }
    const chybi = chybejiciPolozky(z, sber)
    if (chybi.length) chyby.push(`${jmeno}: ${chybi.join(', ')}`)
    zaci.push(z)
  }
  if (chyby.length) {
    return NextResponse.json(
      { error: `Nelze vygenerovat — v IS chybí povinné údaje (${chyby.length} žáků, doplňte na /dashboard/msmt/udaje-zaku): ${chyby.join('; ')}`, chyby },
      { status: 422 },
    )
  }

  // --- Typ 01 — základní soubor ---
  if (type === '01') {
    const xml = await toWin1250(generateZakladni(zaci, cfg))
    return xmlResponse(xml, `Z${env.izo}_01.xml`)
  }

  // --- Typ 01a — žáci s PO (záznam matriky „a" s pspo > 0) ---
  const svpIds = ((students ?? []) as StudentRow[]).filter((s) => s.has_svp).map((s) => s.id)
  const { data: aRows, error: aErr } = svpIds.length
    ? await supabase.from('student_matrika_a')
        .select('student_id, pspo, indi, nadani, id_znev, uvp, prodl_dv, upr_vyst, typ_tr, sz, zz, zvj, jaz_podp, jaz_prip, valid_from, valid_to')
        .in('student_id', svpIds)
    : { data: [], error: null }
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

  const zaciA: ZakMatrikaA[] = zaci.flatMap((z) => {
    const matrikaA: MatrikaAObdobi[] = (aRows ?? [])
      .filter((r) => r.student_id === z.id && (r.pspo ?? 0) > 0)
      .map((r) => ({
        od: r.valid_from, do: r.valid_to, pspo: r.pspo as number,
        indi: r.indi, nadani: r.nadani, id_znev: r.id_znev,
        uvp: r.uvp, prodl_dv: r.prodl_dv, upr_vyst: r.upr_vyst,
        typ_tr: r.typ_tr, sz: r.sz, zz: r.zz, zvj: r.zvj,
        jaz_podp: r.jaz_podp, jaz_prip: r.jaz_prip,
      }))
    return matrikaA.length && z.kod_zaka_msmt ? [{ ...z, matrikaA }] : []
  })

  const xml = await toWin1250(generateSouborA(zaciA, cfg))
  return xmlResponse(xml, `Z${env.izo}_01a.xml`)
}
