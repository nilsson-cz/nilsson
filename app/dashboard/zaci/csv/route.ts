// app/dashboard/zaci/csv/route.ts
// CSV export seznamu žáků školního roku. Sloupce: Třída, Jméno, Příjmení,
// Datum narození. Rok z ?rok= (v mezích zobrazených roků), jinak aktivní.
// Guard: přihlášený zaměstnanec (jakákoli role) — stejná úroveň jako stránka
// /dashboard/zaci; data z get_students_roster (SECURITY DEFINER).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

function formatDate(d: string | null): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  }

  const { data: staffRaw } = await supabase
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!staffRaw) {
    return NextResponse.json({ error: 'Export je dostupný jen zaměstnancům.' }, { status: 403 })
  }

  const rokParam = request.nextUrl.searchParams.get('rok')
  const visibleYears = await getVisibleSchoolYears()
  const rok =
    rokParam && visibleYears.includes(rokParam)
      ? rokParam
      : await getActiveSchoolYear()

  const { data, error } = await supabase.rpc('get_students_roster', {
    p_school_year: rok,
  })
  if (error) {
    return NextResponse.json({ error: `Export selhal: ${error.message}` }, { status: 500 })
  }

  const header = ['Třída', 'Jméno', 'Příjmení', 'Datum narození']
  const lines = [header.join(';')]
  for (const r of (data as any[]) ?? []) {
    lines.push(
      [
        csvEscape(r.trida ?? ''),
        csvEscape(r.first_name ?? ''),
        csvEscape(r.last_name ?? ''),
        formatDate(r.birth_date ?? null),
      ].join(';')
    )
  }

  // BOM — Excel na Windows jinak zobrazí diakritiku špatně.
  const csvContent = '﻿' + lines.join('\r\n')
  const safeRok = rok.replace('/', '-')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="zaci_${safeRok}.csv"`,
    },
  })
}
