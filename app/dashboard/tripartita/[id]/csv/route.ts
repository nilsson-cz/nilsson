// app/dashboard/tripartita/[id]/csv/route.ts
// CSV export obsazených termínů tripartitní události: termín, den, čas, třída,
// dítě a poznámka rodiče z rezervace. Oddělovač ';' + BOM → český Excel.
// Guard: zaměstnanec, který vidí detail události (data dál omezuje RLS).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getReservationRows } from '@/lib/tripartita-prehled'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  }

  const { data: staff } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!staff) {
    return NextResponse.json({ error: 'Export je dostupný jen zaměstnancům.' }, { status: 403 })
  }

  const { data: event } = await supabase
    .from('tripartita_events')
    .select('name, school_year')
    .eq('id', id)
    .maybeSingle()
  if (!event) {
    return NextResponse.json({ error: 'Událost nenalezena.' }, { status: 404 })
  }

  const rows = await getReservationRows(supabase, id, event.school_year)

  const header = ['Termín', 'Den', 'Čas', 'Třída', 'Dítě', 'Poznámka rodiče']
  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push(
      [r.slotLabel, r.den, r.cas, r.trida, r.dite, r.poznamka].map(csvEscape).join(';'),
    )
  }

  const csvContent = '﻿' + lines.join('\r\n')
  const safeName = event.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tripartita_${safeName || 'rezervace'}.csv"`,
    },
  })
}
