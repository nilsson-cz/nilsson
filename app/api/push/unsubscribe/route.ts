// app/api/push/unsubscribe/route.ts
// POST /api/push/unsubscribe — zruší odběr přihlášeného ZZ (Mikrozprávy, TRD §4.3).
// Body: { endpoint }

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nepřihlášen.' }, { status: 401 })

  let endpoint = ''
  try {
    const body = (await req.json()) as { endpoint?: unknown }
    endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  } catch {
    // prázdné tělo → 400 níže
  }
  if (!endpoint) return NextResponse.json({ error: 'Chybí endpoint.' }, { status: 400 })

  const { error } = await supabase.rpc('push_unsubscribe', { p_endpoint: endpoint })
  if (error) {
    console.error('[push/unsubscribe]', error.message)
    return NextResponse.json({ error: 'Odběr se nepodařilo zrušit.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
