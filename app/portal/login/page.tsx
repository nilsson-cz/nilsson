'use client'

/**
 * app/portal/login/page.tsx
 * Magic link / OTP přihlášení pro zákonné zástupce.
 * Flow: zadání emailu → Supabase pošle 8-místný OTP kód → rodič zadá kód → přihlášení
 */

import { useState, useEffect } from 'react'
import Script from 'next/script'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { Database } from '@/types/database'
import { NilssonLogo } from '@/components/NilssonLogo'

// CAPTCHA (Cloudflare Turnstile): Supabase Auth má "Enable Captcha protection"
// zapnuté projektově, takže vyžaduje captchaToken u KAŽDÉHO signInWithOtp volání,
// nejen na /zapis/prihlaseni. Bez tohohle widgetu Supabase Auth tiše vrací error
// a signInWithOtp selže s obecnou hláškou.
declare global {
  interface Window {
    turnstile?: { reset: (widgetId?: string) => void }
    onPortalTurnstileVerify?: (token: string) => void
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_link:     'Odkaz je neplatný nebo vypršela jeho platnost. Požádejte o nový.',
  session_exchange: 'Nepodařilo se ověřit přihlašovací odkaz. Zkuste to znovu.',
  auth_failed:      'Přihlášení selhalo. Zkuste to znovu.',
  not_guardian:     'Tento email není registrován jako zákonný zástupce.',
  server_error:     'Chyba serveru. Zkuste to za chvíli.',
  invalid_otp:      'Nesprávný nebo expirovaný kód. Zkuste to znovu nebo si vyžádejte nový.',
}

type FormState = 'idle' | 'loading' | 'sent' | 'verifying' | 'error'

function PortalLoginInner() {
  const router = useRouter()
  const [email, setEmail]         = useState('')
  const [otp, setOtp]             = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [callbackError, setCallbackError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err && ERROR_MESSAGES[err]) {
      setCallbackError(ERROR_MESSAGES[err])
    }
  }, [])

  useEffect(() => {
    window.onPortalTurnstileVerify = (token: string) => setCaptchaToken(token)
    return () => { delete window.onPortalTurnstileVerify }
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

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp.trim(),
      type:  'email',
    })

    if (error) {
      console.error('verifyOtp error:', error.message)
      setFormState('sent') // vrátíme zpět na zadání kódu
      setErrorMessage(ERROR_MESSAGES['invalid_otp'])
      return
    }

    window.location.href = '/portal/omluvenky/'
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
          <NilssonLogo size={48} />
        </div>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          Nilsson
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Rodičovský portál ZŠ Vilekula Teplice
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
                Zadejte svůj email — pošleme vám přihlašovací kód.
              </p>
              <form onSubmit={handleSubmitEmail} noValidate>
                <div className="mb-4">
                  <label htmlFor="email" className="block text-xs font-medium text-stone-600 mb-1.5 uppercase tracking-wide">
                    Email
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
                    placeholder="rodic@example.com"
                    className="w-full rounded-xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  />
                </div>
                <div className="mb-4">
                  <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} data-callback="onPortalTurnstileVerify" />
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
          Přihlášení je možné pouze pro zákonné zástupce žáků ZŠ Vilekula.
        </p>
      </div>
    </div>
  )
}

export default function PortalLoginPage() {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <PortalLoginInner />
    </>
  )
}
