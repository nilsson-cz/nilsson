import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { safeNext } from '@/lib/role'

// app/auth/callback/route.ts
// PKCE callback — zpracuje magic link pro zaměstnance i zákonné zástupce.
//
// 1. Vymění code za session (Supabase PKCE flow).
// 2. Kam dál rozhodne rozcestník /auth/rozcestnik (role, next, poslední role);
//    tam se také napáruje zákonný zástupce podle e-mailu (get_or_link_guardian_self)
//    a uživatel bez role se odhlásí s ?error=no_access.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createSupabaseServerClient()
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    console.error('[auth/callback] exchangeCodeForSession', exchangeError)
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
  }

  const cil = new URL('/auth/rozcestnik', request.url)
  if (next) cil.searchParams.set('next', next)
  return NextResponse.redirect(cil)
}
