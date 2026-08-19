// app/zivot/_lib/session.ts
// Nezávislé ověření na straně Server Componentu (belt & suspenders).
// Next 16: proxy nemusí krýt Server Functions → stránka si platnost ověří sama.
// MANTINEL: access_token_valid vrací boolean; cokoli != true (i chyba/prázdno)
// se považuje za neplatné.

import { cookies } from 'next/headers'
import { createWebClient } from '@/lib/supabase-web'

export type ZivotSession =
  | { valid: true; schoolYear: string }
  | { valid: false; schoolYear: null }

export async function getZivotSession(): Promise<ZivotSession> {
  const store = await cookies()
  const tokenId = store.get('zivot_sess')?.value
  const schoolYear = store.get('zivot_year')?.value ?? ''
  if (!tokenId) return { valid: false, schoolYear: null }

  try {
    const supabase = createWebClient()
    const { data, error } = await supabase
      .schema('web')
      .rpc('access_token_valid', { p_id: tokenId })
    if (error || data !== true) return { valid: false, schoolYear: null }
    return { valid: true, schoolYear }
  } catch {
    return { valid: false, schoolYear: null }
  }
}
