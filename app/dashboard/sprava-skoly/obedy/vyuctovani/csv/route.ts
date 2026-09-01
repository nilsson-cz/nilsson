// app/dashboard/sprava-skoly/obedy/vyuctovani/csv/route.ts
// CSV export měsíčního vyúčtování obědů. Sloupce: Třída, Jméno, Příjmení,
// Kategorie, Počet obědů, Cena/oběd, Částka. Měsíc z ?ym=YYYY-MM.
// Guard: ředitel (data z lunch_month_billing = SECURITY DEFINER, guard uvnitř).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

/** ?ym=YYYY-MM → {year, month}; jinak předchozí měsíc. */
function parseYm(ym: string | null): { year: number; month: number } {
  const m = ym?.match(/^(\d{4})-(0[1-9]|1[0-2])$/)
  if (m) return { year: Number(m[1]), month: Number(m[2]) }
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })

  const { data: isDir } = await supabase.rpc('is_director')
  if (!isDir) return NextResponse.json({ error: 'Jen pro ředitele.' }, { status: 403 })

  const { year, month } = parseYm(request.nextUrl.searchParams.get('ym'))

  const { data, error } = await supabase.rpc('lunch_month_billing', { p_year: year, p_month: month })
  if (error) {
    return NextResponse.json({ error: `Export selhal: ${error.message}` }, { status: 500 })
  }

  const header = ['Třída', 'Jméno', 'Příjmení', 'Kategorie', 'Počet obědů', 'Cena/oběd', 'Částka']
  const lines = [header.join(';')]
  for (const r of data ?? []) {
    lines.push([
      csvEscape(r.trida ?? ''),
      csvEscape(r.first_name ?? ''),
      csvEscape(r.last_name ?? ''),
      csvEscape(r.age_category ?? ''),
      String(r.meals ?? 0),
      r.unit_price != null ? String(r.unit_price) : '',
      r.amount != null ? String(r.amount) : '',
    ].join(';'))
  }

  const csvContent = '﻿' + lines.join('\r\n')
  const ym = `${year}-${String(month).padStart(2, '0')}`

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="obedy_vyuctovani_${ym}.csv"`,
    },
  })
}
