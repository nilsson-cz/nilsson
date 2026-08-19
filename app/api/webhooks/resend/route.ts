// app/api/webhooks/resend/route.ts
// POST /api/webhooks/resend
// Přijímá Resend webhook eventy a zapisuje je do email_events.
// Ověřuje podpis pomocí svix (Resend ho používá interně).

import { NextRequest, NextResponse } from 'next/server';
import { Webhook }                   from 'svix';
import { createSupabaseAdmin }       from '@/lib/supabase-server';

// Typy Resend webhook payloadu
type ResendWebhookType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.delivery_delayed'
  | 'email.bounced'
  | 'email.complained'
  | 'email.opened';

interface ResendWebhookPayload {
  type: ResendWebhookType;
  created_at: string;
  data: {
    email_id: string;       // = resend_id v email_events
    from:     string;
    to:       string[];
    subject:  string;
    [key: string]: unknown;
  };
}

// Mapování Resend event type → náš event_type v email_events
const EVENT_TYPE_MAP: Record<ResendWebhookType, string> = {
  'email.sent':             'sent',        // jen pro jistotu, obvykle nepřichází
  'email.delivered':        'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced':          'bounced',
  'email.complained':       'complained',
  'email.opened':           'opened',
};

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhooks/resend] Chybí RESEND_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Misconfigured' }, { status: 500 });
  }

  // Načteme raw body pro ověření podpisu
  const rawBody = await req.text();

  // Svix hlavičky
  const svixId        = req.headers.get('svix-id')        ?? '';
  const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
  const svixSignature = req.headers.get('svix-signature') ?? '';

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
  }

  // Ověření podpisu
  let payload: ResendWebhookPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      'svix-id':        svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendWebhookPayload;
  } catch (err) {
    console.error('[webhooks/resend] Neplatný podpis:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const eventType = EVENT_TYPE_MAP[payload.type];
  if (!eventType) {
    // Neznámý typ — ignorujeme, ale vracíme 200 ať Resend neopakuje
    return NextResponse.json({ ok: true, skipped: true });
  }

  const resendId = payload.data.email_id;

  // Použijeme admin klienta — webhook přichází bez uživatelského JWT
  const supabase = createSupabaseAdmin();

  // Najdeme původní email_events záznam podle resend_id
  const { data: original, error: findError } = await supabase
    .from('email_events')
    .select('id, source_type, source_id, guardian_id, email_address')
    .eq('resend_id', resendId)
    .eq('event_type', 'sent')
    .maybeSingle();

  if (findError) {
    console.error('[webhooks/resend] Chyba při hledání záznamu:', findError);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  if (!original) {
    // Resend_id neznámé — může být platební email nebo jiný zdroj
    // Logujeme, ale vracíme 200
    console.warn('[webhooks/resend] Neznámé resend_id:', resendId);
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Zapíšeme nový email_events záznam
  const { error: insertError } = await supabase
    .from('email_events')
    .insert({
      source_type:   original.source_type,
      source_id:     original.source_id,
      guardian_id:   original.guardian_id,
      email_address: original.email_address,
      event_type:    eventType,
      resend_id:     resendId,
      metadata:      payload.data as unknown as never,
    });

  if (insertError) {
    // 'opened' může přijít vícekrát; partiální unique index (migrace 082) drží
    // per (source, guardian) max jeden řádek → duplicitu (23505) očekáváme a spolkneme.
    if (eventType === 'opened' && insertError.code === '23505') {
      return NextResponse.json({ ok: true, event: eventType, duplicate: true });
    }
    console.error('[webhooks/resend] Insert error:', insertError);
    return NextResponse.json({ error: 'DB insert error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, event: eventType });
}
