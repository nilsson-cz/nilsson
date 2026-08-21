// lib/api-auth.ts
// Sdílený guard pro API route handlery. Řada /api/* route spoléhala jen na RLS
// (žádný explicitní auth/role check) — druhý zámek k RLS. requireStaff() vrátí
// buď { supabase, staffId } přihlášeného ZAMĚSTNANCE, nebo NextResponse (401/403)
// k okamžitému návratu. Rodič (authenticated bez staff řádku) → 403.
// (audit 2026-08-20, nálezy 4.1/4.4)
//
// Použití:
//   const guard = await requireStaff()
//   if (guard instanceof NextResponse) return guard
//   const { supabase, staffId } = guard

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function requireStaff() {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data: staffRow, error: staffError } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (staffError || !staffRow) {
    return NextResponse.json({ error: 'Staff record not found' }, { status: 403 })
  }
  return { supabase, staffId: (staffRow as { id: string }).id }
}
