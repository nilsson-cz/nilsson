// app/auth/rozcestnik/route.ts
// Rozcestník po přihlášení (OTP i magic link). Zjistí, jaké role přihlášený
// uživatel má, a pošle ho do dashboardu školy, do rodičovského portálu, nebo
// — má-li obě — do té, kterou použil naposledy (cookie nilsson_role, nastavuje proxy).
// get_or_link_guardian_self zároveň napáruje zákonného zástupce podle e-mailu
// při prvním přihlášení (stejně jako dřív layout portálu).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { cilPoPrihlaseni, jeAktivniZamestnanec, parseRole, ROLE_COOKIE, ZDROJ_APP } from '@/lib/role'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Appka z plochy (manifest start_url ?zdroj=app) — příznak přežije i přihlášení.
  const app = request.nextUrl.searchParams.get('zdroj') === ZDROJ_APP
  if (!user) return NextResponse.redirect(new URL(app ? `/login?zdroj=${ZDROJ_APP}` : '/login', request.url))

  const [{ data: staff }, { data: guardianRows }] = await Promise.all([
    supabase.from('staff').select('id, employment_end').eq('user_id', user.id).maybeSingle(),
    supabase.rpc('get_or_link_guardian_self'),
  ])

  const cil = cilPoPrihlaseni({
    // Bývalý zaměstnanec (po employment_end) už do dashboardu nesmí; jako rodič ano.
    isStaff: !!staff && jeAktivniZamestnanec(staff.employment_end),
    isGuardian: (guardianRows?.length ?? 0) > 0,
    next: request.nextUrl.searchParams.get('next'),
    lastRole: parseRole(request.cookies.get(ROLE_COOKIE)?.value),
    app,
  })

  if (!cil) {
    await supabase.auth.signOut()
    const err = staff ? 'inactive' : 'no_access'
    return NextResponse.redirect(new URL(`/login?error=${err}`, request.url))
  }
  return NextResponse.redirect(new URL(cil, request.url))
}
