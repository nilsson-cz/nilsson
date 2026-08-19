import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// app/auth/callback/route.ts
// PKCE callback — zpracuje magic link pro staff i guardian.
//
// Logika:
// 1. Vymění code za session (Supabase PKCE flow)
// 2. Zkontroluje staff tabulku → redirect /dashboard
// 3. Zkontroluje guardians tabulku:
//    a) user_id již napárován → redirect /portal
//    b) email odpovídá guardians.email, user_id NULL → auto-link + redirect /portal
// 4. Jinak → sign out + redirect /login?error=no_access

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const next  = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createSupabaseServerClient()

  // 1. Vyměnit code za session
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeError) {
    console.error('[auth/callback] exchangeCodeForSession', exchangeError)
    return NextResponse.redirect(new URL('/login?error=auth_failed', request.url))
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login?error=no_user', request.url))
  }

  // 2. Je to staff?
  const { data: staffData } = await supabase
    .from('staff')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (staffData) {
    // Staff → přesměrovat na dashboard (nebo na původní next)
    const destination = next.startsWith('/dashboard') ? next : '/dashboard'
    return NextResponse.redirect(new URL(destination, request.url))
  }

  // 3a. Je to guardian s již napárovaným user_id?
  const { data: guardianByUserId } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (guardianByUserId) {
    const destination = next.startsWith('/portal') ? next : '/portal/omluvenky'
    return NextResponse.redirect(new URL(destination, request.url))
  }

  // 3b. Nový guardian — email musí sedět na guardians.email (auto-link)
  if (user.email) {
    const { data: guardianByEmail } = await supabase
      .from('guardians')
      .select('id, user_id')
      .eq('email', user.email)
      .is('user_id', null)    // ještě nespárovaný
      .maybeSingle()

    if (guardianByEmail) {
      // Napárovat user_id → guardian.id (první přihlášení)
      const { error: linkError } = await supabase
        .from('guardians')
        .update({ user_id: user.id })
        .eq('id', (guardianByEmail as any).id)

      if (linkError) {
        console.error('[auth/callback] guardian link error', linkError)
        // Pokračovat i přes chybu linkování — guardian se dostane dál
      }

      return NextResponse.redirect(new URL('/portal/omluvenky', request.url))
    }
  }

  // 4. Neznámý uživatel — odhlásit a informovat
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login?error=no_access', request.url))
}
