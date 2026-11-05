// app/portal/potvrzeni/pdf/route.ts
// GET ?student=<id>&ucel=<text>&rc=1 → PDF „Potvrzení o studiu".
// Guard: přihlášený zákonný zástupce s aktivní vazbou na docházejícího žáka
// (ověřuje gatherPotvrzeni běžným RLS klientem, data pak čte service-role).
// Každé stažení = nové vydání: zápis do evidence (migrace 170) s ověřovacím
// kódem + QR na /overeni/<kód>, do PDF se vloží sken podpisu a razítka.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { gatherPotvrzeni } from '@/lib/potvrzeni-o-studiu/gather'
import { renderPotvrzeniPdf } from '@/lib/potvrzeni-o-studiu/pdf'
import { zaevidujVydani } from '@/lib/potvrzeni-o-studiu/overeni'
import { getPodpisy } from '@/lib/potvrzeni-o-studiu/podpis-storage'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asciiSlug(str: string): string {
  return (
    str
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'zak'
  )
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const studentId = sp.get('student') ?? ''
  if (!UUID_RE.test(studentId)) {
    return NextResponse.json({ error: 'Chybí nebo je neplatný identifikátor žáka.' }, { status: 400 })
  }
  // Účel: volný text, jeden řádek, max 120 znaků.
  const ucel = (sp.get('ucel') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null
  const uvestRc = sp.get('rc') === '1'

  const supabase = await createSupabaseServerClient()
  const res = await gatherPotvrzeni(supabase, studentId, { ucel, uvestRc })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  let pdf: Buffer
  try {
    const [overeni, podpisy] = await Promise.all([
      zaevidujVydani({ studentId, guardianId: res.guardianId, data: res.data, baseUrl }),
      getPodpisy(),
    ])
    pdf = await renderPotvrzeniPdf({ ...res.data, overeni, podpis: podpisy.podpis, razitko: podpisy.razitko })
  } catch (e) {
    console.error('[potvrzeni-o-studiu] render:', e)
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 })
  }

  const filename = `potvrzeni-o-studiu_${asciiSlug(res.jmenoSoubor.last)}_${asciiSlug(res.jmenoSoubor.first)}.pdf`
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
