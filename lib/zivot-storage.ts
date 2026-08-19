// lib/zivot-storage.ts
// Izolované úložiště fotek zdi „Ze života školy" v Supabase Storage (nahrazuje
// dřívější Google Shared Drive). Bucket je PRIVÁTNÍ — bajty nejsou veřejné.
// Přístup jde výhradně přes tento server-only modul přes service role.
//
// GDPR: sám modul NEfiltruje publikovatelnost — signed URL se smí vygenerovat
// jen pro fotku, kterou volající PŘED tím ověřil (anon RLS `photo_is_publishable`
// na zdi, nebo staff v dashboardu). Service role obchází RLS, takže gating musí
// proběhnout dřív. URL jsou krátkodobě platné → i po úniku brzy vyprší a po
// odvolání souhlasu při dalším renderu nová URL nevznikne.
//
// Nesahá na sdílený staff kód (mantinel #1) — jen čte `createSupabaseAdmin`.

import 'server-only'
import { randomUUID } from 'crypto'
import { createSupabaseAdmin } from '@/lib/supabase-server'

const BUCKET = 'zivot-photos'
const DEFAULT_TTL = 3600 // s — jak dlouho podepsaná URL platí

function bucket() {
  return createSupabaseAdmin().storage.from(BUCKET)
}

/** Nahraje obrázek do bucketu, vrátí object key (ukládá se do photos.drive_file_id). */
export async function uploadPhoto(
  galleryId: string,
  bytes: ArrayBuffer,
  mimeType: string
): Promise<string> {
  const key = `${galleryId}/${randomUUID()}.jpg`
  const { error } = await bucket().upload(key, bytes, {
    contentType: mimeType || 'image/jpeg',
    upsert: false,
  })
  if (error) throw new Error(`Storage: upload selhal (${error.message}).`)
  return key
}

/** Smaže objekt z bucketu (best-effort; prázdný key ignoruje). */
export async function deletePhoto(key: string): Promise<void> {
  if (!key) return
  const { error } = await bucket().remove([key])
  if (error) throw new Error(`Storage: smazání selhalo (${error.message}).`)
}

/** Podepsaná URL pro jeden objekt; null když key chybí nebo objekt neexistuje. */
export async function signedUrl(key: string, ttl = DEFAULT_TTL): Promise<string | null> {
  if (!key) return null
  const { data, error } = await bucket().createSignedUrl(key, ttl)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * Dávkově podepíše více objektů → Map(key → signedUrl). Neexistující/chybné
 * klíče v mapě prostě chybí (volající je ošetří jako „bez fotky").
 */
export async function signedUrlMap(keys: string[], ttl = DEFAULT_TTL): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const unique = [...new Set(keys.filter(Boolean))]
  if (unique.length === 0) return map
  const { data, error } = await bucket().createSignedUrls(unique, ttl)
  if (error || !data) return map
  for (const item of data) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl)
  }
  return map
}
