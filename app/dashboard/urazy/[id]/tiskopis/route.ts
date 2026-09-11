// app/dashboard/urazy/[id]/tiskopis/route.ts
// GET → PDF tiskopis „Záznam o úrazu". Guard: ředitel (shodně s RLS modulu).
// Data z urazy_zaznam (+ aktualizace); render z lib/urazy-pdf.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { renderUrazZaznamPdf } from '@/lib/urazy-pdf'
import { formatPoradove, type UrazZaznam, type UrazAktualizace } from '@/lib/urazy'

// react-pdf potřebuje Node runtime (ne edge).
export const runtime = 'nodejs'

/** Bezpečný ASCII základ názvu souboru. */
function asciiSlug(str: string): string {
  return (
    str
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'uraz'
  )
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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
    return NextResponse.json({ error: 'Tiskopis může vygenerovat jen ředitel.' }, { status: 403 })
  }

  // RLS stejně omezuje na ředitele; .single vrátí prázdno, pokud přístup není.
  const { data: zaznam } = await supabase
    .from('urazy_zaznam')
    .select('*')
    .eq('id', id)
    .single<UrazZaznam>()

  if (!zaznam) {
    return NextResponse.json({ error: 'Záznam nenalezen.' }, { status: 404 })
  }

  const { data: aktualizace } = await supabase
    .from('urazy_aktualizace')
    .select('*')
    .eq('uraz_id', id)
    .order('created_at', { ascending: true })
    .returns<UrazAktualizace[]>()

  let pdf: Buffer
  try {
    pdf = await renderUrazZaznamPdf(zaznam, aktualizace ?? [])
  } catch (e) {
    console.error('[urazy] render PDF:', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  const cislo = formatPoradove(zaznam.poradove_cislo, zaznam.skolni_rok).replace('/', '-')
  const filename = `zaznam-o-urazu_${cislo}_${asciiSlug(zaznam.zraneny_prijmeni)}_${asciiSlug(zaznam.zraneny_jmeno)}.pdf`

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
