// app/dashboard/zapis/csv/route.ts
// CSV export: jméno dítěte + kontakt primárního zástupce, omezeno na
// jeden rok_zapisu (odvozený z created_at, viz lib/enrollment/dashboard-queries).
// Guard: jen director — stejná kontrola jako na /dashboard/zapis stránce,
// RLS (enrollment_app_staff_read) by jinak pustila i guide/assistant/vp.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getEnrollmentCsvData, aktualniRokZapisu } from '@/lib/enrollment/dashboard-queries'
import { STAV_LABELS, type EnrollmentStav } from '@/lib/enrollment/types'

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
    .from('staff')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if ((staffRaw as any)?.role !== 'director') {
    return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })
  }

  const rokParam = request.nextUrl.searchParams.get('rok')
  const rok = rokParam ? Number(rokParam) : aktualniRokZapisu()

  const rows = await getEnrollmentCsvData(rok)

  const header = [
    'Jméno dítěte',
    'Příjmení dítěte',
    'Datum narození',
    'Typ',
    'Stav',
    'Vlastník (zástupce)',
    'E-mail zástupce',
    'Telefon zástupce',
  ]

  const lines = [header.join(';')]
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.dite_jmeno),
        csvEscape(r.dite_prijmeni),
        r.datum_narozeni,
        r.typ === 'zapis' ? 'Zápis' : 'Přestup',
        csvEscape(STAV_LABELS[r.stav as EnrollmentStav] ?? r.stav),
        csvEscape(r.vlastnik_jmeno),
        csvEscape(r.vlastnik_email),
        csvEscape(r.vlastnik_telefon),
      ].join(';')
    )
  }

  // BOM na začátku — Excel na Windows jinak CSV s diakritikou zobrazí
  // špatně (interpretuje jako jinou kódovou stránku bez BOM).
  const csvContent = '\uFEFF' + lines.join('\r\n')

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="zapis_${rok}.csv"`,
    },
  })
}
