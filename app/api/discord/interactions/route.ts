// app/api/discord/interactions/route.ts
// Interactions Endpoint Discord aplikace mikrozpráv (TRD §3.3).
// 1) ověří Ed25519 podpis (neplatný → 401), 2) zpracuje interakci do 3 s,
// 3) pomalé části (náhled s počty příjemců) dokončí v after() přes PATCH.
// Env: DISCORD_PUBLIC_KEY, DISCORD_APP_ID, SUPABASE_SERVICE_ROLE_KEY

import { NextRequest, NextResponse, after } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'
import { verifyDiscordSignature } from '@/lib/mikrozpravy/discord-verify'
import { handleInteraction, type DiscordInteraction } from '@/lib/mikrozpravy/interactions'
import { ephemeralText } from '@/lib/mikrozpravy/discord-ui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY
  if (!publicKey) return new NextResponse('Not configured', { status: 503 })

  const body = await req.text()
  const ok = await verifyDiscordSignature({
    body,
    signatureHex: req.headers.get('x-signature-ed25519'),
    timestamp: req.headers.get('x-signature-timestamp'),
    publicKeyHex: publicKey,
  })
  if (!ok) return new NextResponse('Invalid request signature', { status: 401 })

  let interaction: DiscordInteraction
  try {
    interaction = JSON.parse(body) as DiscordInteraction
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  // PING (ověření URL v Developer Portalu) nesmí záviset na DB ani dalším env.
  if (interaction.type === 1) return NextResponse.json({ type: 1 })

  try {
    const result = await handleInteraction(interaction, createSupabaseAdmin())
    if (result.later) after(result.later)
    return NextResponse.json(result.response)
  } catch (e) {
    console.error('[discord/interactions]', e)
    return NextResponse.json(ephemeralText('⚠️ Něco se pokazilo. Zkuste to prosím znovu, případně dejte vědět řediteli.'))
  }
}
