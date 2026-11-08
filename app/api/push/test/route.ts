// app/api/push/test/route.ts
// POST /api/push/test — pošle testovací notifikaci na všechny aktivní odběry
// přihlášeného ZZ (Mikrozprávy, spike F1-0 + nastavení portálu, TRD §4.3).
// Čtení odběrů přes RLS (ps_select_own); revokace a last_success_at přes service
// role (pro ZZ záměrně neexistuje UPDATE policy).

import { NextResponse } from 'next/server'
import { createSupabaseAdmin, createSupabaseServerClient } from '@/lib/supabase-server'
import { isPushConfigured, sendPush } from '@/lib/push/web-push'

export async function POST() {
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'Upozornění nejsou na serveru nastavená.' }, { status: 503 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nepřihlášen.' }, { status: 401 })

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .is('revoked_at', null)
  if (error) {
    console.error('[push/test]', error.message)
    return NextResponse.json({ error: 'Nepodařilo se načíst odběry.' }, { status: 500 })
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json({ error: 'Na žádném zařízení nemáte zapnutá upozornění.' }, { status: 404 })
  }

  const admin = createSupabaseAdmin()
  const now = new Date().toISOString()
  const time = new Date().toLocaleTimeString('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit',
  })

  const results = await Promise.all(subs.map(async (s) => {
    const r = await sendPush(s, {
      v: 1,
      title: 'ZŠ Vilekula · test',
      body: `Upozornění fungují 🎉 (odesláno ${time})`,
      url: '/portal',
      tag: 'push-test',
    }, { ttlSeconds: 600 })

    if (r.ok) {
      await admin.from('push_subscriptions').update({ last_success_at: now }).eq('id', s.id)
    } else if (r.gone) {
      await admin.from('push_subscriptions')
        .update({ revoked_at: now, revoke_reason: 'gone', updated_at: now })
        .eq('id', s.id)
    } else {
      console.error('[push/test] send failed', r.status, r.detail)
    }
    return r
  }))

  const sent = results.filter(r => r.ok).length
  const gone = results.filter(r => !r.ok && r.gone).length
  return NextResponse.json({ ok: sent > 0, sent, gone, total: subs.length })
}
