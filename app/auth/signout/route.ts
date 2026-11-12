import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

// Odhlášení → vždy jednotná přihlašovací stránka (zaměstnanci i rodiče).
export async function POST() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_APP_URL!)
  )
}
