// app/dashboard/kontakty-rodicu/csv/route.ts
// CSV export telefonů zákonných zástupců pro vybrané třídy (pro rychlé nahrání
// kontaktů do mobilu / hromadnou komunikaci školy). Params: ?rok=&tridy=A,B.
// Oddělovač ';' + BOM → přímé otevření v českém Excelu.
// Guard: jen ředitel. Data přes lib/guardian-contacts (sdíleno s vCard route).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'
import { getGuardianContacts } from '@/lib/guardian-contacts'

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
  if ((staffRaw as any)?.role !== 'director') {
    return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })
  }

  const q = request.nextUrl.searchParams

  const rokParam = q.get('rok')
  const visibleYears = await getVisibleSchoolYears()
  const rok =
    rokParam && visibleYears.includes(rokParam) ? rokParam : await getActiveSchoolYear()

  const tridy = (q.get('tridy') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (tridy.length === 0) {
    return NextResponse.json({ error: 'Nebyla vybrána žádná třída.' }, { status: 400 })
  }

  const result = await getGuardianContacts(supabase, rok, tridy)
  if (!result.ok) {
    return NextResponse.json({ error: `Export selhal: ${result.error}` }, { status: 500 })
  }

  const header = ['Třída', 'Žák', 'Zákonný zástupce', 'Vztah', 'Telefon', 'Telefon 2', 'E-mail']
  const lines = [header.join(';')]
  for (const c of result.contacts) {
    lines.push(
      [
        c.trida,
        `${c.zakLast} ${c.zakFirst}`,
        `${c.guardianFirst} ${c.guardianLast}`.trim(),
        c.roleLabel,
        c.phonePrimary,
        c.phoneSecondary,
        c.email,
      ]
        .map((v) => csvEscape(String(v)))
        .join(';')
    )
  }

  const csvContent = '﻿' + lines.join('\r\n')
  const safeRok = rok.replace('/', '-')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kontakty_rodicu_${safeRok}.csv"`,
    },
  })
}
