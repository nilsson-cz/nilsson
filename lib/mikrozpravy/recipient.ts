import 'server-only'
import type { NextRequest } from 'next/server'
import type { Admin, MicroMessage } from './data'
import { isWellFormedToken, tokenHashHex } from './token'

// lib/mikrozpravy/recipient.ts
// Dohledání příjemce podle osobního tokenu (/z/{token}) + společné kontroly POST.

export interface RecipientRow {
  id: string
  message_id: string
  guardian_id: string
  token_expires_at: string
  best_state: number
}

export async function findByToken(
  admin: Admin, token: string,
): Promise<{ recipient: RecipientRow; message: MicroMessage } | null> {
  if (!isWellFormedToken(token)) return null
  const { data: recipient } = await admin.from('micro_recipients')
    .select('id, message_id, guardian_id, token_expires_at, best_state')
    .eq('token_hash', tokenHashHex(token))
    .maybeSingle()
  if (!recipient || new Date(recipient.token_expires_at).getTime() < Date.now()) return null
  const { data: message } = await admin.from('micro_messages').select('*').eq('id', recipient.message_id).maybeSingle()
  if (!message) return null
  return { recipient, message }
}

/**
 * POST na /api/z/* smí přijít jen z našeho originu (stránka, service worker,
 * sendBeacon). Chybějící Origin (některé starší prohlížeče u beaconu) tolerujeme —
 * tajemstvím je token v cestě.
 */
export function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    return new URL(origin).host === host
  } catch {
    return false
  }
}
