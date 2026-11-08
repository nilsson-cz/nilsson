// app/api/inbound/email/route.ts
// Příchozí odpovědi rodičů na e-maily mikrozpráv (PRD D11, Resend Receiving).
//
// Tok: rodič odpoví na e-mail → Reply-To odpoved+<recipientId><hmac>@MICRO_REPLY_DOMAIN
//      → Resend (MX subdomény) → webhook `email.received` sem (svix podpis)
//      → dotažení textu přes API → odfiltrovat automatické odpovědi, oříznout citaci
//      → micro_replies (channel 'email') → tick pošle upozornění do Discordu.
//
// Env: RESEND_INBOUND_WEBHOOK_SECRET (signing secret webhooku pro email.received),
//      MICRO_REPLY_DOMAIN (např. odpovedi.zsvilekula.cz), RESEND_API_KEY.
// Vždy vrací 200 u zpracovaných/zahozených zpráv, ať Resend zbytečně neopakuje.

import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { Resend } from 'resend'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { isAutoReply, parseReplyAddress, stripQuotedReply } from '@/lib/mikrozpravy/f3-text'
import { storeReply } from '@/lib/mikrozpravy/replies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ReceivedPayload {
  type: string
  data: { email_id: string; from: string; to: string[]; cc?: string[]; subject: string }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  const domain = process.env.MICRO_REPLY_DOMAIN?.trim()
  if (!secret || !domain || !process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const raw = await req.text()
  let payload: ReceivedPayload
  try {
    payload = new Webhook(secret).verify(raw, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    }) as ReceivedPayload
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (payload.type !== 'email.received') return NextResponse.json({ ok: true, skipped: 'type' })

  // Komu: hledáme naši odpovědní adresu v To/Cc.
  const recipientId = [...(payload.data.to ?? []), ...(payload.data.cc ?? [])]
    .map(a => parseReplyAddress(a, domain)).find((x): x is string => !!x)
  if (!recipientId) return NextResponse.json({ ok: true, skipped: 'address' })

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data: email, error } = await resend.emails.receiving.get(payload.data.email_id)
  if (error || !email) {
    console.error('[inbound/email] receiving.get', error)
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 }) // ať Resend zkusí znovu
  }

  if (isAutoReply(email.headers, email.subject ?? '')) return NextResponse.json({ ok: true, skipped: 'auto-reply' })

  const text = stripQuotedReply(email.text ?? (email.html ?? '').replace(/<[^>]+>/g, ' '))
  if (!text) return NextResponse.json({ ok: true, skipped: 'empty' })

  const admin = createSupabaseAdmin()
  const { data: recipient } = await admin.from('micro_recipients').select('id, message_id').eq('id', recipientId).maybeSingle()
  if (!recipient) return NextResponse.json({ ok: true, skipped: 'recipient' })
  const { data: message } = await admin.from('micro_messages').select('*').eq('id', recipient.message_id).maybeSingle()
  if (!message) return NextResponse.json({ ok: true, skipped: 'message' })

  const r = await storeReply(admin, message, recipient.id, 'email', text, {
    email_id: payload.data.email_id,
    from: payload.data.from.slice(0, 200),
  })
  if (!r.ok) console.error('[inbound/email] store', r.error)
  return NextResponse.json({ ok: true })
}
