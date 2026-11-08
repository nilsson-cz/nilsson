// app/api/push/subscribe/route.ts
// POST /api/push/subscribe — uloží web push odběr přihlášeného ZZ (Mikrozprávy, TRD §4.3).
// Body: { endpoint, keys: { p256dh, auth }, standalone?: boolean }
// Zápis jen přes RPC push_subscribe (SECURITY DEFINER, guard current_guardian_id()).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { detectPlatform } from '@/lib/push/web-push'

interface SubscribeBody {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
  standalone?: unknown
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nepřihlášen.' }, { status: 401 })

  let body: SubscribeBody
  try {
    body = (await req.json()) as SubscribeBody
  } catch {
    return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 })
  }

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : ''
  const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : ''
  const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : ''
  if (!endpoint.startsWith('https://') || endpoint.length > 1000 || !p256dh || !auth) {
    return NextResponse.json({ error: 'Neplatný odběr.' }, { status: 400 })
  }

  const ua = req.headers.get('user-agent') ?? ''
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: ua,
    p_platform: detectPlatform(ua, body.standalone === true),
  })
  if (error) {
    console.error('[push/subscribe]', error.message)
    return NextResponse.json({ error: 'Odběr se nepodařilo uložit.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
