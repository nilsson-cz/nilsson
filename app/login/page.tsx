'use client'

/**
 * app/login/page.tsx
 * OTP přihlášení pro zaměstnance školy.
 * Flow: zadání emailu → Supabase pošle 8-místný OTP kód → zadání kódu → přihlášení
 */

import { useState, useEffect } from 'react'
import Script from 'next/script'
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

// CAPTCHA (Cloudflare Turnstile): Supabase Auth má "Enable Captcha protection"
// zapnuté projektově, takže vyžaduje captchaToken u KAŽDÉHO signInWithOtp
// volání. Bez widgetu signInWithOtp tiše selže s obecnou hláškou.
declare global {
  interface Window {
    turnstile?: { reset: (widgetId?: string) => void }
    onStaffTurnstileVerify?: (token: string) => void
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link:     'Odkaz je neplatný nebo vypršela jeho platnost. Požádejte o nový.',
  session_exchange: 'Nepodařilo se ověřit přihlašovací odkaz. Zkuste to znovu.',
  auth_failed:      'Přihlášení selhalo. Zkuste to znovu.',
  not_staff:        'Tento email není registrován jako zaměstnanec školy.',
  inactive:         'Váš účet byl deaktivován. Kontaktujte ředitele školy.',
  server_error:     'Chyba serveru. Zkuste to za chvíli.',
  invalid_otp:      'Nesprávný nebo expirovaný kód. Zkuste to znovu nebo si vyžádejte nový.',
}

type FormState = 'idle' | 'loading' | 'sent' | 'verifying' | 'error'

function LoginInner() {
  const [email, setEmail]         = useState('')
  const [otp, setOtp]             = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMessage, setErrorMessage]     = useState<string | null>(null)
  const [callbackError, setCallbackError]   = useState<string | null>(null)
  const [captchaToken, setCaptchaToken]     = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err && ERROR_MESSAGES[err]) {
      setCallbackError(ERROR_MESSAGES[err])
    }
  }, [])

  useEffect(() => {
    window.onStaffTurnstileVerify = (token: string) => setCaptchaToken(token)
    return () => { delete window.onStaffTurnstileVerify }
  }, [])

  function resetCaptcha() {
    window.turnstile?.reset()
    setCaptchaToken(null)
  }

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Krok 1: odeslání emailu
  async function handleSubmitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    if (!captchaToken) {
      setFormState('error')
      setErrorMessage('Potvrďte prosím, že nejste robot.')
      return
    }
    setFormState('loading')
    setErrorMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: false,
        captchaToken,
      },
    })

    resetCaptcha() // Turnstile token je jednorázový — po použití vždy resetovat.

    if (error) {
      setFormState('error')
      setErrorMessage('Nepodařilo se odeslat kód. Zkontrolujte email a zkuste to znovu.')
      return
    }
    setFormState('sent')
  }

  // Krok 2: ověření OTP kódu
  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otp.trim()) return
    setFormState('verifying')
    setErrorMessage(null)

    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp.trim(),
      type:  'email',
    })

    if (error) {
      console.error('verifyOtp error:', error.message)
      setFormState('sent')
      setErrorMessage(ERROR_MESSAGES['invalid_otp'])
      return
    }

    // Ověříme že je to staff
    const { data: staffData } = await supabase
      .from('staff')
      .select('id')
      .eq('user_id', data.user?.id ?? '')
      .maybeSingle()

    if (!staffData) {
      await supabase.auth.signOut()
      setFormState('error')
      setErrorMessage(ERROR_MESSAGES['not_staff'])
      return
    }

    window.location.href = '/dashboard/'
  }

  function handleReset() {
    setFormState('idle')
    setErrorMessage(null)
    setCallbackError(null)
    setEmail('')
    setOtp('')
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4">
      <div className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-50 mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="-5.0 -10.0 110.0 115.0" width="48" height="48" aria-hidden="true"><path fill="#F97316" d="m20.719 15.188c-1.0664 0-1.9219 0.36719-2.4648 0.97656-0.54297 0.60547-0.75 1.3906-0.71484 2.1367l-0.003906-0.003906v0.003906c0.035156 0.74219 0.30469 1.4766 0.78516 2.0508 0.48438 0.57813 1.2148 0.99609 2.0742 0.99609 0.55859 0 1.3555-0.097656 2.3086-0.11719 0.95703-0.019531 2.043 0.042969 3.0312 0.32031 0.99219 0.28125 1.8711 0.76562 2.5234 1.6133 0.65234 0.84766 1.1055 2.0859 1.1055 3.9883 0 1.9609-0.78906 3.3242-2.082 4.5898-1.2891 1.2617-3.0859 2.3555-4.9336 3.5586-1.8438 1.2031-3.7461 2.5195-5.2031 4.3281-1.457 1.8047-2.4492 4.1172-2.4492 7.1367 0 3.6953 1.0859 6.3633 2.7539 8.1992 1.6641 1.8359 3.8633 2.8203 6.0117 3.332 3.0117 0.71484 5.7852 0.53125 7.2578 0.35156l-4.0078 9.5391c-0.28125 0.19141-2.1094 1.4297-4.1758 2.8828-1.1016 0.77734-2.2188 1.5781-3.0977 2.2422-0.4375 0.33203-0.81641 0.62891-1.1133 0.87891l-0.003907-0.003906c-0.28125 0.23828-0.50781 0.41016-0.67578 0.69922-0.32422 0.55859-0.28906 1.2188-0.21875 1.9844h0.003907c0.074218 0.78125 0.25391 1.6953 0.51953 2.6289 0.53125 1.8594 1.3438 3.7969 2.668 4.7539 0.23047 0.16797 0.54297 0.17969 0.78516 0.027344 0.41406-0.26172 0.60156-0.67188 0.77344-1.0781 0.17578-0.41797 0.32812-0.90625 0.48828-1.4297h-0.003906c0.31641-1.0469 0.65625-2.2422 1.0781-3.0977 0.082031-0.16797 0.55859-0.66406 1.2539-1.1523 0.69922-0.48828 1.6211-1.0391 2.6211-1.6172 1.9961-1.1602 4.293-2.4414 5.9102-3.8359 2.0391-1.7656 4.0547-4.7148 5.5742-7.1719 0.67188 1.1367 1.4453 2.4648 2.1484 3.7617 0.44922 0.83203 0.85156 1.6172 1.1367 2.2383 0.14063 0.30469 0.24609 0.58594 0.32031 0.79297 0.070313 0.21094 0.09375 0.42578 0.09375 0.31641 0 1.3945-0.875 3.9688-1.4922 6.125-0.30859 1.0781-0.55859 2.0586-0.5625 2.8984h-0.003907v0.003906c0 0.41797 0.058594 0.84375 0.30859 1.2148 0.26953 0.39453 0.73438 0.60938 1.2227 0.60938h10.391c0.51562-0.003906 0.86328-0.60547 0.60547-1.0547-0.73438-1.2773-2.1484-1.5664-3.1992-1.832-0.52734-0.13281-0.99609-0.26562-1.2969-0.42969-0.3125-0.16797-0.43359-0.29297-0.51562-0.59766-0.18359-0.68359 0.23438-2.1914 0.81641-3.8477 0.58594-1.6602 1.2734-3.5195 1.1719-5.332-0.12891-2.4219-1.3438-5.957-2.3477-8.6172l6.2383-0.042969c-0.19141 0.58984-0.45312 1.4258-0.76172 2.5586-0.24609 0.91016-0.47656 1.8594-0.60156 2.6836-0.066406 0.41016-0.10547 0.78906-0.10547 1.1367 0 0.33203 0.019532 0.67969 0.21094 1.0039 3.125 5.418 9.9688 16.004 9.9688 16.008 0.12891 0.20312 0.35547 0.32422 0.59375 0.32422h6.8242c0.55078-0.003906 0.88672-0.69141 0.55469-1.1289-0.75-0.99219-1.6211-1.5508-2.4453-1.957-0.82031-0.40234-1.582-0.67578-2.2461-1.1016 0.035156 0.019532-0.22266-0.21484-0.43359-0.55078-0.21484-0.33984-0.46875-0.8125-0.73438-1.3633-0.53125-1.1055-1.1172-2.5391-1.6797-4.0117-1.1172-2.9453-2.1367-6.0859-2.4062-7.0977v-0.007813c-0.054688-0.20312-0.011719-0.64844 0.16016-1.1523 0.17188-0.50391 0.44922-1.0703 0.75-1.582 0.17969-0.30078 0.33984-0.54297 0.49219-0.76953 0.20312 0.63672 0.40625 1.2734 0.80469 2.457 0.33594 0.99219 0.69922 2.0273 1.0312 2.918s0.625 1.6133 0.89453 2.0742c2.4453 4.2383 8.1602 11.199 8.1602 11.199 0.13281 0.16406 0.33594 0.25781 0.55078 0.25781h8.1055c0.51953 0 0.86719-0.60547 0.60547-1.0547-0.90234-1.5625-2.5195-1.8672-3.7812-2.1016-0.62891-0.11719-1.1992-0.23047-1.625-0.42188-0.43359-0.19531-0.71094-0.41797-0.93359-0.89453h-0.003907c-0.023437-0.039062-0.046875-0.078125-0.078125-0.10938l0.039063 0.054687s-1.0352-1.7617-2.2031-4.0234c-1.168-2.2617-2.4688-5.0469-2.9766-6.9453l0.003907-0.003906c-0.20703-0.76172-0.89844-2.8242-1.4844-4.9961-0.29297-1.0859-0.55859-2.1875-0.71484-3.1211-0.15234-0.92969-0.16406-1.7422-0.09375-1.9961v-0.003906c0.25-0.93359 0.81641-1.4922 1.7734-1.9453 0.95312-0.44922 2.2695-0.71484 3.7656-0.88281 2.9922-0.33594 6.6602-0.29688 9.7539-1.125 0.83594-0.22266 1.2773-1.0117 1.3945-1.7969 0.11719-0.77734 0-1.6445-0.23828-2.5039v0.003907-0.003907c-0.24609-0.86328-0.63281-1.7227-1.1406-2.4375-0.41016-0.57812-0.91406-1.0664-1.5195-1.3555-0.11328-0.67969-0.51172-2.5352-1.8828-4.2852-1.6914-2.1602-4.9258-3.8359-10.215-2.1523-2.3633 0.75-3.8359 2.2266-4.6641 3.8398-0.64844 1.2695-0.90625 2.6016-0.98828 3.7891-0.24609-0.085938-0.38281-0.12891-0.82031-0.27734-0.73047-0.24609-1.6992-0.55859-2.832-0.87109-2.2656-0.625-5.1875-1.2461-8.1914-1.3203-6.4062-0.16406-15.328 1.9688-19.238 7.5352-0.50391 0.13281-3.4297 0.86719-6.4219 0.73828-1.6406-0.070313-3.2344-0.42188-4.3555-1.1992-1.125-0.78125-1.8438-1.9297-1.8438-3.9922 0-1.6797 0.81641-3.1172 2.1602-4.5469 1.3477-1.4258 3.1992-2.7891 5.0859-4.2109s3.8086-2.9102 5.2891-4.6641c1.4805-1.7539 2.5195-3.8164 2.5195-6.2734 0-3.3867-0.75781-6.5117-3.1211-8.7539-2.3633-2.2383-6.2031-3.5078-12.133-3.5078z"/></svg>
        </div>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          Nilsson
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Informační systém ZŠ Vilekula Teplice
        </p>
      </div>

      <div className="w-full max-w-sm">
        {callbackError && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {callbackError}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">

          {/* ── Krok 2: zadání OTP kódu ── */}
          {formState === 'sent' || formState === 'verifying' ? (
            <div>
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50 mb-4">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-stone-900 mb-1">Zkontrolujte email</h2>
                <p className="text-sm text-stone-500 mb-1">Zaslali jsme 8-místný kód na</p>
                <p className="text-sm font-medium text-stone-800 break-all">{email}</p>
              </div>

              <form onSubmit={handleVerifyOtp} noValidate>
                <div className="mb-4">
                  <label htmlFor="otp" className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide">
                    Přihlašovací kód
                  </label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={8}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    disabled={formState === 'verifying'}
                    placeholder="12345678"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition text-center tracking-widest font-mono text-lg"
                  />
                </div>

                {errorMessage && (
                  <p className="mb-4 text-sm text-red-600">{errorMessage}</p>
                )}

                <button
                  type="submit"
                  disabled={formState === 'verifying' || otp.length < 8}
                  className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {formState === 'verifying' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Ověřuji…
                    </span>
                  ) : 'Přihlásit se'}
                </button>
              </form>

              <div className="mt-4 text-center">
                <button onClick={handleReset} className="text-sm text-stone-400 hover:text-stone-600 transition">
                  Zadat jiný email
                </button>
              </div>
            </div>

          ) : (
            /* ── Krok 1: zadání emailu ── */
            <>
              <h2 className="text-lg font-semibold text-stone-900 mb-1">Přihlášení</h2>
              <p className="text-sm text-stone-500 mb-6">
                Zadejte svůj pracovní email — pošleme vám přihlašovací kód.
              </p>
              <form onSubmit={handleSubmitEmail} noValidate>
                <div className="mb-4">
                  <label htmlFor="email" className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide">
                    Pracovní email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={formState === 'loading'}
                    placeholder="jmeno@zsvilekula.cz"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  />
                </div>
                <div className="mb-4">
                  <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} data-callback="onStaffTurnstileVerify" />
                </div>

                {formState === 'error' && errorMessage && (
                  <p className="mb-4 text-sm text-red-600">{errorMessage}</p>
                )}
                <button
                  type="submit"
                  disabled={formState === 'loading' || !email.trim() || !captchaToken}
                  className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 active:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {formState === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Odesílám…
                    </span>
                  ) : 'Odeslat přihlašovací kód'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          Přihlášení je možné pouze pro pedagogy a zaměstnance školy.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <LoginInner />
    </>
  )
}
