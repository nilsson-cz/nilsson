// app/dashboard/vykaz-ku/csv/route.ts
// CSV souhrn „Měsíčního výkazu pro KÚ" — všechny dosavadní zmrazené měsíce,
// co měsíc, to sloupec. Oddělovač ';' + BOM → přímé otevření v českém Excelu.
// Guard: jen director (RLS by jinak pustila i další role).

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  VYKAZ_ROWS, displayValue, monthLabel, type VykazMonthValues,
} from '@/lib/vykaz-ku'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

type SnapRow = {
  rok: number
  mesic: number
} & VykazMonthValues

export async function GET() {
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

  const { data, error } = await supabase
    .from('vykaz_ku_snapshot')
    .select('rok, mesic, std_36, jiny_38, indiv_41, druzina_pocet, obed_pocet')
    .order('rok', { ascending: true })
    .order('mesic', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const months = (data ?? []) as SnapRow[]

  // Hlavička: „Ukazatel" + jeden sloupec na každý měsíc.
  const header = ['Ukazatel', ...months.map((m) => monthLabel({ year: m.rok, month: m.mesic }))]
  const lines = [header.map((h) => csvEscape(h)).join(';')]

  // Řádek na každý ukazatel, hodnoty přes měsíce.
  for (const r of VYKAZ_ROWS) {
    const cells = [r.label, ...months.map((m) => displayValue(m[r.key]))]
    lines.push(cells.map((c) => csvEscape(String(c))).join(';'))
  }

  const csvContent = '﻿' + lines.join('\r\n')
  const dnes = new Date().toISOString().slice(0, 10)

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vykaz_ku_${dnes}.csv"`,
    },
  })
}
