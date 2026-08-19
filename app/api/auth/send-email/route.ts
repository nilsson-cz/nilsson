import { Resend } from 'resend'
import { Webhook } from 'standardwebhooks'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

// KRITICKÉ — bez tohohle ověření je endpoint veřejný open-relay: kdokoli
// s URL adresou může poslat vlastní {user, email_data} a nechat systém
// odeslat e-mail (vydávající se za ZŠ Vilekula) na libovolnou adresu s
// libovolným obsahem. Supabase Send Email Hook musí ověřovat podpis podle
// Standard Webhooks specifikace (webhook-id/webhook-timestamp/
// webhook-signature hlaviček) — viz oficiální dokumentace:
// https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
//
// SEND_EMAIL_HOOK_SECRET se generuje v Supabase dashboardu:
// Authentication -> Hooks -> Send Email hook -> Generate Secret.
// Formát je "v1,whsec_<base64>" — prefix se před použitím odřízne.
//
// POZOR: dřív se tohle počítalo na module-level (`const hookSecret = ...`
// mimo handler) — pokud proměnná chyběla, `(undefined as string).replace(...)`
// spadlo s neošetřenou výjimkou HNED při startu funkce, ještě před
// jakýmkoli try/catch. Supabase pak dostal jen obecné "Unexpected status
// code returned from hook: 500" bez jakékoli stopy PROČ. Přesunuto dovnitř
// handleru s explicitní kontrolou, ať je příští podobný problém vidět
// rovnou v Supabase Auth Logs (message pole), ne až po dolování ve Vercel
// function logs.
function getHookSecret(): string {
  const raw = process.env.SEND_EMAIL_HOOK_SECRET
  if (!raw) {
    throw new Error('SEND_EMAIL_HOOK_SECRET není nastavená (env proměnná chybí)')
  }
  return raw.replace('v1,whsec_', '')
}

export async function POST(request: Request) {
  let hookSecret: string
  try {
    hookSecret = getHookSecret()
  } catch (err) {
    console.error('send-email hook: chybí konfigurace', err)
    return NextResponse.json(
      { error: 'Server misconfigured: SEND_EMAIL_HOOK_SECRET chybí' },
      { status: 500 },
    )
  }

  // Musí být SYROVÝ text, ne .json() — podpis se počítá nad přesným
  // bytovým obsahem těla požadavku. Reserializace přes JSON.parse/stringify
  // by mohla (byť vzácně) změnit byte-přesný tvar a rozbít verifikaci.
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers)

  const wh = new Webhook(hookSecret)

  let verified: {
    user: { email: string }
    email_data: {
      token?: string
      token_hash?: string
      redirect_to?: string
      email_action_type?: string
    }
  }

  try {
    verified = wh.verify(rawBody, headers) as typeof verified
  } catch (err) {
    // Neplatný/chybějící podpis — požadavek nepochází ze Supabase Auth.
    // 401, ne 400/500, ať je v logách jasně vidět, že šlo o autentizační
    // odmítnutí, ne o běžnou chybu zpracování.
    console.error('send-email hook: ověření podpisu selhalo', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { user, email_data } = verified

  // Používáme OTP kód (token) místo magic linku (token_hash).
  // Token_hash způsoboval problémy s PKCE flow — code_verifier nebyl
  // dostupný v prohlížeči rodiče. OTP kód tento problém obchází.
  const otpCode = email_data.token

  if (!otpCode) {
    console.error('send-email hook: chybí token', { email_data })
    return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  }

  let error: unknown = null
  try {
    const result = await resend.emails.send({
      from: 'ZŠ Vilekula <noreply@zsvilekula.cz>',
      to: user.email,
      subject: 'Přihlášení do rodičovského portálu',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="font-size: 18px; font-weight: 600; margin-bottom: 16px;">
            Přihlášení do portálu ZŠ Vilekula
          </h2>
          <p style="color: #555; margin-bottom: 24px;">
            Zadejte níže uvedený kód na přihlašovací stránce.
            Kód je platný 1 hodinu.
          </p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111827; font-family: monospace;">
              ${otpCode}
            </span>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 32px;">
            Pokud jste tento email neočekávali, ignorujte jej.
          </p>
        </div>
      `,
    })
    error = result.error
  } catch (err) {
    // Resend SDK může za určitých okolností (síť, neplatný klíč) vyhodit
    // výjimku místo vrácení {error} — dřív by to spadlo bez JSON odpovědi
    // stejně jako chybějící hookSecret výše. Zachyceno záměrně.
    console.error('Resend threw:', err)
    error = err
  }

  if (error) {
    console.error('Resend error:', error)
    return NextResponse.json({ error: 'Email send failed' }, { status: 500 })
  }

  return NextResponse.json({ message: 'ok' })
}
