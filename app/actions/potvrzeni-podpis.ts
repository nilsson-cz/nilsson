'use server'

// app/actions/potvrzeni-podpis.ts
// Nahrání / smazání skenu podpisu ředitele a razítka školy pro potvrzení
// o studiu (Nastavení, director-only). Úložiště: privátní bucket skola-podpis.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  uploadPodpis,
  deletePodpis,
  MAX_BYTES,
  ALLOWED_MIME,
  PODPIS_KINDS,
  type PodpisKind,
} from '@/lib/potvrzeni-o-studiu/podpis-storage'

type Result = { ok: true } | { ok: false; error: string }

async function isDirector(): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'director'
}

function parseKind(v: FormDataEntryValue | null): PodpisKind | null {
  return PODPIS_KINDS.includes(v as PodpisKind) ? (v as PodpisKind) : null
}

export async function uploadPotvrzeniPodpis(formData: FormData): Promise<Result> {
  if (!(await isDirector())) return { ok: false, error: 'Nahrát může jen ředitel.' }
  const kind = parseKind(formData.get('kind'))
  const file = formData.get('file')
  if (!kind) return { ok: false, error: 'Neznámý typ obrázku.' }
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Vyberte soubor.' }
  if (!ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number])) {
    return { ok: false, error: 'Povolené formáty jsou PNG a JPG.' }
  }
  if (file.size > MAX_BYTES) return { ok: false, error: 'Soubor je větší než 800 kB.' }

  try {
    await uploadPodpis(kind, await file.arrayBuffer(), file.type)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Nahrání selhalo.' }
  }
  revalidatePath('/dashboard/nastaveni')
  return { ok: true }
}

export async function deletePotvrzeniPodpis(kind: PodpisKind): Promise<Result> {
  if (!(await isDirector())) return { ok: false, error: 'Smazat může jen ředitel.' }
  if (!PODPIS_KINDS.includes(kind)) return { ok: false, error: 'Neznámý typ obrázku.' }
  try {
    await deletePodpis(kind)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Smazání selhalo.' }
  }
  revalidatePath('/dashboard/nastaveni')
  return { ok: true }
}
