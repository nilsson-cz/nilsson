// app/dashboard/zaci/[id]/katalogovy-list/route.ts
// GET → PDF katalogového listu žáka (pro přestup). Guard: ředitel / VP.
// Data z lib/katalogovy-list/gather; render z lib/katalogovy-list/pdf.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { gatherKatalogovyList } from '@/lib/katalogovy-list/gather'
import { renderKatalogovyListPdf } from '@/lib/katalogovy-list/pdf'

// react-pdf potřebuje Node runtime (ne edge).
export const runtime = 'nodejs'

/** Bezpečný ASCII základ názvu souboru. */
function asciiSlug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'zak'
  )
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
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
  const role = (staffRaw as { role?: string } | null)?.role
  if (role !== 'director' && role !== 'vp') {
    return NextResponse.json(
      { error: 'Katalogový list může vygenerovat jen ředitel nebo výchovný poradce.' },
      { status: 403 }
    )
  }

  let data
  try {
    data = await gatherKatalogovyList(id)
  } catch (e) {
    console.error('[katalogovy-list] gather:', e)
    return NextResponse.json({ error: 'Sběr dat selhal.' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Žák nenalezen.' }, { status: 404 })
  }

  let pdf: Buffer
  try {
    pdf = await renderKatalogovyListPdf(data)
  } catch (e) {
    console.error('[katalogovy-list] render:', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  const filename = `katalogovy-list_${asciiSlug(data.identifikace.prijmeni)}_${asciiSlug(data.identifikace.jmeno)}.pdf`

  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
