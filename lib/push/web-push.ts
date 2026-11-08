import 'server-only'
import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push'

// lib/push/web-push.ts
// Odesílání web push notifikací (modul Mikrozprávy, TRD §4.4).
// Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…)

export interface PushPayload {
  v: 1
  title: string
  body: string
  url: string
  tag?: string
  token?: string
  urgent?: boolean
  actions?: { action: string; title: string }[]
}

export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushSendResult =
  | { ok: true; status: number }
  | { ok: false; gone: boolean; status: number | null; detail: string }

let configured = false

function ensureConfigured(): void {
  if (configured) return
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) {
    throw new Error('Web push není nakonfigurován (chybí VAPID_* env).')
  }
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
}

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT,
  )
}

/**
 * Pošle jednu notifikaci na jeden odběr.
 * 404/410 = odběr zanikl (`gone: true`) → volající ho má revokovat.
 */
export async function sendPush(
  sub: StoredSubscription,
  payload: PushPayload,
  opts: { urgent?: boolean; ttlSeconds?: number; topic?: string } = {},
): Promise<PushSendResult> {
  ensureConfigured()
  const subscription: WebPushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  }
  try {
    const res = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: opts.ttlSeconds ?? 24 * 60 * 60,
      urgency: opts.urgent ? 'high' : 'normal', // Android Doze — naléhavé musí jít hned
      topic: opts.topic,
      timeout: 10_000,
    })
    return { ok: true, status: res.statusCode }
  } catch (err) {
    if (err instanceof WebPushError) {
      return {
        ok: false,
        gone: err.statusCode === 404 || err.statusCode === 410,
        status: err.statusCode,
        detail: err.body || err.message,
      }
    }
    return { ok: false, gone: false, status: null, detail: String(err) }
  }
}

/** Hrubá heuristika platformy z User-Agentu (jen pro metriky pokrytí). */
export function detectPlatform(ua: string, standalone: boolean): 'ios-pwa' | 'android' | 'desktop' | 'other' {
  if (/iPhone|iPad|iPod/i.test(ua)) return standalone ? 'ios-pwa' : 'other'
  if (/Android/i.test(ua)) return 'android'
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop'
  return 'other'
}
