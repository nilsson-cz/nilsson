'use client'

// app/portal/_components/PushOnboarding.tsx
// Zapnutí web push upozornění v rodičovském portálu (Mikrozprávy, TRD §4.3 / PRD §12).
//
// Stavy:
//   ios-install  — iPhone v Safari: push jde jen z PWA na ploše → návod „Přidat na plochu"
//   unsupported  — prohlížeč push neumí
//   denied       — uživatel upozornění zablokoval v systému/prohlížeči
//   off          — lze zapnout (žádost o povolení AŽ po kliknutí)
//   on           — odběr existuje a je uložen na serveru
//
// Spike F1-0: součástí je i diagnostika (platforma, standalone, povolení) a tlačítko
// testovacího upozornění — slouží k ověření na reálném iPhonu/Androidu.

import { useCallback, useEffect, useState } from 'react'

type State = 'loading' | 'ios-install' | 'unsupported' | 'denied' | 'off' | 'on'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  return navigator.serviceWorker.ready
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, standalone: isStandalone() }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Odběr se nepodařilo uložit.')
  }
}

export function PushOnboarding() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [diag, setDiag] = useState('')

  const refresh = useCallback(async () => {
    const ios = isIos()
    const standalone = isStandalone()
    const supported = pushSupported()
    const perm = 'Notification' in window ? Notification.permission : 'n/a'
    setDiag(`${ios ? 'iOS' : 'jiné'} · ${standalone ? 'na ploše' : 'v prohlížeči'} · push ${supported ? 'ano' : 'ne'} · povolení ${perm}`)

    if (ios && !standalone) return setState('ios-install')
    if (!supported || !VAPID_PUBLIC_KEY) return setState('unsupported')
    if (Notification.permission === 'denied') return setState('denied')

    const reg = await getRegistration()
    const sub = await reg.pushManager.getSubscription()
    if (sub && Notification.permission === 'granted') {
      // Srovnat se serverem (odběr mohl být revokován nebo patří jinému ZZ).
      await saveSubscription(sub).catch(() => {})
      return setState('on')
    }
    setState('off')
  }, [])

  useEffect(() => {
    // Detekce běží až v prohlížeči (navigator/window) — odložit mimo render effectu.
    const t = setTimeout(() => {
      refresh().catch(() => setState('unsupported'))
    }, 0)
    return () => clearTimeout(t)
  }, [refresh])

  async function enable() {
    setBusy(true)
    setMessage(null)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await getRegistration()
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }))
      await saveSubscription(sub)
      setState('on')
      setMessage('Upozornění jsou zapnutá. Zkuste si poslat testovací.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Zapnutí se nepodařilo.')
    } finally {
      setBusy(false)
      refresh().catch(() => {})
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      const reg = await getRegistration()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setState('off')
      setMessage('Upozornění na tomto zařízení jsou vypnutá.')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; sent?: number; total?: number; gone?: number
      }
      if (!res.ok && data.error) setMessage(data.error)
      else setMessage(`Odesláno na ${data.sent ?? 0} z ${data.total ?? 0} zařízení${data.gone ? ` (${data.gone} zaniklé odebráno)` : ''}. Notifikace by měla dorazit do pár sekund.`)
    } catch {
      setMessage('Test se nepodařilo odeslat.')
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return null

  return (
    <section className="portal-card px-4 py-4 space-y-3" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-(--portal-accent-subtle) text-(--portal-accent)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-(--portal-text)">Upozornění ze školy</p>

          {state === 'ios-install' && (
            <div className="text-sm text-(--portal-text-muted) mt-1 space-y-1">
              <p>Na iPhonu chodí upozornění jen z aplikace na ploše:</p>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Klepněte na <strong>Sdílet</strong> (čtvereček se šipkou) dole v Safari.</li>
                <li>Zvolte <strong>Přidat na plochu</strong>.</li>
                <li>Otevřete <strong>Nilsson</strong> z plochy, přihlaste se a zapněte upozornění.</li>
              </ol>
            </div>
          )}

          {state === 'unsupported' && (
            <p className="text-sm text-(--portal-text-muted) mt-1">
              Tento prohlížeč upozornění neumí. Zprávy vám budou chodit e-mailem.
            </p>
          )}

          {state === 'denied' && (
            <p className="text-sm text-(--portal-text-muted) mt-1">
              Upozornění jsou v nastavení zablokovaná. Povolte je v nastavení telefonu
              (u iPhonu: Nastavení → Oznámení → Nilsson) a stránku obnovte.
            </p>
          )}

          {state === 'off' && (
            <p className="text-sm text-(--portal-text-muted) mt-1">
              Rychlé zprávy z výletů a ze školy (zpoždění, změny, ankety) vám přijdou rovnou do telefonu.
            </p>
          )}

          {state === 'on' && (
            <p className="text-sm text-(--portal-text-muted) mt-1">
              Na tomto zařízení jsou upozornění zapnutá.
            </p>
          )}
        </div>
      </div>

      {(state === 'off' || state === 'on') && (
        <div className="flex flex-wrap gap-2">
          {state === 'off' && (
            <button
              type="button"
              onClick={enable}
              disabled={busy}
              className="rounded-lg bg-(--portal-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Zapnout upozornění
            </button>
          )}
          {state === 'on' && (
            <>
              <button
                type="button"
                onClick={test}
                disabled={busy}
                className="rounded-lg bg-(--portal-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Poslat testovací upozornění
              </button>
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="rounded-lg border border-(--portal-border) px-4 py-2 text-sm text-(--portal-text-muted) disabled:opacity-60"
              >
                Vypnout
              </button>
            </>
          )}
        </div>
      )}

      {message && <p className="text-sm text-(--portal-text)">{message}</p>}

      <p className="text-[11px] text-(--portal-text-subtle)">{diag}</p>
    </section>
  )
}
