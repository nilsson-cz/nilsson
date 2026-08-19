'use server'

// app/actions/access-tokens.ts
// Vydávání a rotace tokenů zdi "Ze života školy" (schema web.access_tokens).
// Insert/update smí jen ředitel — RLS admin_manage_tokens (web.is_admin())
// je finální pojistka, tyto akce proto musí běžet pod session ředitele.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateToken, hashToken } from '@/lib/access-token'

async function web() {
  const supabase = await createSupabaseServerClient()
  return supabase.schema('web')
}

/**
 * Vydá nový roční token zdi. Plaintext token se vrací JEN teď (nikde se
 * neukládá, v DB je jen jeho hash).
 */
export async function issueAccessToken(schoolYear: string, label?: string) {
  const token = generateToken()
  const token_hash = await hashToken(token)

  const { data, error } = await (await web())
    .from('access_tokens')
    .insert({ token_hash, scope: 'zivot', school_year: schoolYear, label })
    .select('id')
    .single()
  if (error) throw error

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.zsvilekula.cz'
  revalidatePath('/admin/zivot')
  return { id: data.id as string, token, url: `${base}/zivot?k=${token}` }
}

/** Odvolá token (zneplatní i běžící session — middleware ověřuje při každém requestu). */
export async function revokeAccessToken(id: string) {
  const { error } = await (await web())
    .from('access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
  revalidatePath('/admin/zivot')
}

/** Rotace = vydej nový + odvolej starý. */
export async function rotateAccessToken(oldId: string, schoolYear: string, label?: string) {
  const issued = await issueAccessToken(schoolYear, label)
  await revokeAccessToken(oldId)
  return issued
}
