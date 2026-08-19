// app/dashboard/tridni-kniha/priznaky/csv/route.ts
// CSV export přehledu příznaků třídnice (Hospitace…). Stejné filtry jako stránka
// (typ, od, do, group, osoba). Oddělovač ';' + BOM → přímé otevření v českém Excelu.
// Guard: jen director (RLS by jinak pustila i další role).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getPriznakReport } from '@/lib/tridnice-priznaky-report'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  }

  const { data: staffRaw } = await supabase
    .from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if ((staffRaw as any)?.role !== 'director') {
    return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })
  }

  const q = request.nextUrl.searchParams
  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const od = q.get('od')
  const doo = q.get('do')
  const rows = await getPriznakReport({
    typ_kod: q.get('typ') || null,
    od: od && dateRe.test(od) ? od : null,
    do: doo && dateRe.test(doo) ? doo : null,
    group_id: q.get('group') || null,
    osoba_id: q.get('osoba') || null,
  })

  const header = [
    'Datum', 'Čas od', 'Čas do', 'Třída', 'Blok',
    'Koho se týkalo', 'Příznak', 'Hospitující', 'Poznámka', 'Zapsal', 'Zapsáno',
  ]
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push([
      r.datum,
      r.cas_od,
      r.cas_do,
      r.trida,
      r.blok_nazev,
      r.obsazeni,
      r.typ_nazev,
      r.osoba,
      r.poznamka,
      r.nastavil,
      new Date(r.nastaveno_at).toLocaleString('cs-CZ'),
    ].map((v) => csvEscape(String(v))).join(';'))
  }

  const csvContent = '﻿' + lines.join('\r\n')
  const dnes = new Date().toISOString().slice(0, 10)

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="priznaky_tridnice_${dnes}.csv"`,
    },
  })
}
