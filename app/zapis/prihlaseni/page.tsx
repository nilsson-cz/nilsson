'use client'

import { useState, useEffect, Suspense } from 'react'
import Script from 'next/script'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Database } from '@/types/database'

// app/zapis/prihlaseni/page.tsx
// OTP přihlášení/registrace pro zápis. NA ROZDÍL od /portal/login se tu
// používá shouldCreateUser: true — noví rodiče se rovnou registrují.
// Po ověření se přesměruje na `next` (default /zapis).
//
// CAPTCHA (Cloudflare Turnstile): tohle je jediné místo v appce, které
// umí založit NOVÝ Auth účet (portál používá shouldCreateUser: false),
// tedy jediné, kde po zapnutí "Allow new users to sign up" v Supabase
// hrozí automatizované zakládání účtů botem. Token se ověřuje server-side
// v Supabase Auth (ne v našem kódu) — frontend jen sesbírá token z widgetu
// a pošle ho jako `options.captchaToken`.

type FormState = 'idle' | 'loading' | 'sent' | 'verifying' | 'error'

declare global {
  interface Window {
    turnstile?: { reset: (widgetId?: string) => void }
    onTurnstileVerify?: (token: string) => void
  }
}

function PrihlaseniInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/zapis'

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  useEffect(() => {
    window.onTurnstileVerify = (token: string) => setCaptchaToken(token)
    return () => { delete window.onTurnstileVerify }
  }, [])

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function resetCaptcha() {
    window.turnstile?.reset()
    setCaptchaToken(null)
  }

  async function handleSubmitEmail(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    if (!captchaToken) {
      setErrorMessage('Potvrďte prosím, že nejste robot.')
      return
    }
    setFormState('loading')
    setErrorMessage(null)

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, captchaToken }, // ← rozdíl oproti portálu
    })

    resetCaptcha() // Turnstile token je jednorázový — po použití vždy resetovat.

    if (error) {
      setFormState('error')
      setErrorMessage('Nepodařilo se odeslat kód. Zkontrolujte e-mail a zkuste to znovu.')
      return
    }
    setFormState('sent')
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otp.trim()) return
    setFormState('verifying')
    setErrorMessage(null)

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: otp.trim(),
      type: 'email',
    })

    if (error) {
      setFormState('sent')
      setErrorMessage('Nesprávný nebo expirovaný kód. Zkuste to znovu nebo si vyžádejte nový.')
      return
    }

    window.location.href = next
  }

  return (
    <div className="max-w-sm mx-auto py-6">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-(--portal-text)">Přihlášení k zápisu</h1>
        <p className="mt-1 text-sm text-(--portal-text-muted)">
          Zadejte e-mail — pošleme vám ověřovací kód. Účet se v případě potřeby
          vytvoří automaticky.
        </p>
      </div>

      {/* overflow:visible přepisuje .portal-card (overflow:hidden) — Turnstile
          widget může při interaktivní výzvě vykreslit víc obsahu, než na
          kolik karta počítala, a overflow:hidden by tlačítko pod ním uřízlo. */}
      <div className="portal-card p-6" style={{ overflow: 'visible' }}>
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {formState !== 'sent' && formState !== 'verifying' ? (
          <form onSubmit={handleSubmitEmail} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-(--portal-text) mb-1">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="vas@email.cz"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} data-callback="onTurnstileVerify" />
            </div>
            <button
              type="submit"
              disabled={formState === 'loading' || !captchaToken}
              className="w-full px-4 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm
                font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {formState === 'loading' ? 'Odesílám…' : 'Poslat ověřovací kód'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <p className="text-sm text-(--portal-text-muted)">
              Na <strong>{email}</strong> jsme poslali ověřovací kód. Zadejte ho níže.
            </p>
            <div>
              <label className="block text-sm font-medium text-(--portal-text) mb-1">
                Ověřovací kód
              </label>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                autoFocus
                inputMode="numeric"
                placeholder="123456"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900
                  tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={formState === 'verifying'}
              className="w-full px-4 py-2.5 rounded-lg bg-(--portal-accent) text-white text-sm
                font-medium hover:opacity-90 disabled:opacity-50 transition"
            >
              {formState === 'verifying' ? 'Ověřuji…' : 'Přihlásit se'}
            </button>
            <button
              type="button"
              onClick={() => { setFormState('idle'); setOtp(''); setErrorMessage(null) }}
              className="w-full text-sm text-(--portal-text-subtle) hover:text-(--portal-text-muted)"
            >
              ← Zadat jiný e-mail
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ZapisPrihlaseniPage() {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <Suspense fallback={<div className="py-6 text-center text-sm text-(--portal-text-subtle)">Načítání…</div>}>
        <PrihlaseniInner />
      </Suspense>
    </>
  )
}
