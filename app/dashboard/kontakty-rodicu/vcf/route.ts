// app/dashboard/kontakty-rodicu/vcf/route.ts
// vCard (.vcf) export telefonů zákonných zástupců pro vybrané třídy.
// Na rozdíl od CSV se .vcf v mobilu otevře a přidá kontakty přímo do adresáře.
// Params: ?rok=&tridy=A,B. Guard: jen ředitel. Data přes lib/guardian-contacts.
//
// Jeden VCARD = jeden zástupce (per žák). FN nese i jméno žáka a třídu, ať se
// kontakt v telefonu snadno dohledá; NOTE má vztah + žáka + třídu.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getActiveSchoolYear, getVisibleSchoolYears } from '@/lib/school-year'
import { getGuardianContacts, type GuardianContact } from '@/lib/guardian-contacts'

// Escapování textových hodnot dle RFC 6350 (vCard). Telefon/e-mail necháváme.
function vEscape(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function buildVCard(c: GuardianContact): string {
  const gFull = `${c.guardianFirst} ${c.guardianLast}`.trim() || 'Zákonný zástupce'
  const zak = `${c.zakLast} ${c.zakFirst}`.trim()
  const fn = `${gFull} – ${zak}${c.trida ? ` (${c.trida})` : ''}`
  const note = [
    c.roleLabel && `Zákonný zástupce: ${c.roleLabel}`,
    zak && `Žák: ${zak}`,
    c.trida && `Třída: ${c.trida}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEscape(c.guardianLast)};${vEscape(c.guardianFirst)};;;`,
    `FN:${vEscape(fn)}`,
  ]
  if (c.phonePrimary) lines.push(`TEL;TYPE=CELL:${vEscape(c.phonePrimary)}`)
  if (c.phoneSecondary) lines.push(`TEL;TYPE=CELL:${vEscape(c.phoneSecondary)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vEscape(c.email)}`)
  if (note) lines.push(`NOTE:${vEscape(note)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
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

  const vcf = result.contacts.map(buildVCard).join('\r\n') + '\r\n'
  const safeRok = rok.replace('/', '-')

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="kontakty_rodicu_${safeRok}.vcf"`,
    },
  })
}
