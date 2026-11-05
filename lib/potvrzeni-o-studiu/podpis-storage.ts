/**
 * lib/potvrzeni-o-studiu/podpis-storage.ts
 *
 * Sken podpisu ředitele a razítka školy pro potvrzení o studiu.
 * Privátní bucket `skola-podpis` (migrace 170), přístup jen service role
 * z tohoto server-only modulu. Obrázky nikdy nejdou do gitu (repo je veřejné).
 *
 * Dva pevné objekty: podpis, razitko (PNG s průhledným pozadím ideálně, JPG
 * jde taky). Content-type se ukládá do objektu a vrací se jako data URI —
 * react-pdf <Image> i náhled v nastavení ho přijmou přímo.
 */

import 'server-only'
import { createSupabaseAdmin } from '@/lib/supabase-server'

const BUCKET = 'skola-podpis'
export const MAX_BYTES = 800 * 1024 // pod výchozím 1MB limitem server action
export const ALLOWED_MIME = ['image/png', 'image/jpeg'] as const

export type PodpisKind = 'podpis' | 'razitko'
export const PODPIS_KINDS: PodpisKind[] = ['podpis', 'razitko']

function bucket() {
  return createSupabaseAdmin().storage.from(BUCKET)
}

export async function uploadPodpis(kind: PodpisKind, bytes: ArrayBuffer, mime: string): Promise<void> {
  const { error } = await bucket().upload(kind, bytes, { contentType: mime, upsert: true })
  if (error) throw new Error(`Storage: nahrání selhalo (${error.message}).`)
}

export async function deletePodpis(kind: PodpisKind): Promise<void> {
  const { error } = await bucket().remove([kind])
  if (error) throw new Error(`Storage: smazání selhalo (${error.message}).`)
}

/** Obrázek jako data URI, nebo null když není nahraný (či bucket chybí). */
export async function getPodpisDataUri(kind: PodpisKind): Promise<string | null> {
  try {
    const { data, error } = await bucket().download(kind)
    if (error || !data) return null
    const mime = ALLOWED_MIME.includes(data.type as (typeof ALLOWED_MIME)[number]) ? data.type : 'image/png'
    const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
    return `data:${mime};base64,${b64}`
  } catch {
    return null
  }
}

export async function getPodpisy(): Promise<Record<PodpisKind, string | null>> {
  const [podpis, razitko] = await Promise.all([getPodpisDataUri('podpis'), getPodpisDataUri('razitko')])
  return { podpis, razitko }
}
