// app/dashboard/urazy/statistika/csv/route.ts
// CSV roční statistiky úrazovosti (?rok=). Oddělovač ';' + BOM → český Excel.
// Guard: jen director (shodně s RLS modulu). Agregace z lib/urazy-statistika.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CURRENT_SCHOOL_YEAR } from '@/lib/config'
import { aggregateUrazy, type UrazStatRow, type CiselnikBucket } from '@/lib/urazy-statistika'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((staffRaw as { role?: string } | null)?.role !== 'director') {
    return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })
  }

  const skolniRok = request.nextUrl.searchParams.get('rok') ?? CURRENT_SCHOOL_YEAR

  const { data, error } = await supabase
    .from('urazy_zaznam')
    .select('datum_cas, je_zaznam, smrtelny, cast_tela, pricina, druh_cinnosti, misto_urazu')
    .eq('skolni_rok', skolniRok)
    .returns<UrazStatRow[]>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const stat = aggregateUrazy(data ?? [], skolniRok)
  const lines: string[] = []
  const row = (a: string, b: string | number) => lines.push([csvEscape(a), csvEscape(String(b))].join(';'))

  row('Statistika úrazovosti — školní rok', skolniRok)
  lines.push('')
  row('Úrazů celkem', stat.celkem)
  row('Se záznamem o úrazu', stat.zaznamu)
  row('Jen kniha úrazů', stat.knihaOnly)
  row('Smrtelných', stat.smrtelnych)

  const blok = (nadpis: string, buckets: CiselnikBucket[]) => {
    lines.push('')
    lines.push(csvEscape(nadpis))
    for (const b of [...buckets].sort((x, y) => y.count - x.count)) {
      row(b.label, b.count)
    }
  }

  lines.push('')
  lines.push(csvEscape('Po měsících'))
  for (const m of stat.poMesicich) row(m.label, m.count)

  blok('Zraněná část těla', stat.castTela)
  blok('Předpokládaná příčina', stat.pricina)
  blok('Druh činnosti', stat.druhCinnosti)
  blok('Místo úrazu', stat.mistoUrazu)

  const csvContent = '﻿' + lines.join('\r\n')
  const rokSlug = skolniRok.replace('/', '-')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="statistika-urazovosti_${rokSlug}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
