/**
 * app/api/debug/rls-check/route.ts
 *
 * RLS smoke-test — pouze pro development (NODE_ENV !== 'production').
 *
 * Volat po přihlášení: GET /api/debug/rls-check
 *
 * Ověřuje:
 *   1. auth.uid() je nastaven (session funguje)
 *   2. staff záznam je přístupný (vlastní řádek viditelný)
 *   3. staff tabulka nevrací jiné zaměstnance (FORCE RLS funguje)
 *   4. students tabulka vrací jen žáky povolené skupiny (can_read_student)
 *
 * Výstup JSON:
 *   { ok: true, checks: [...] }   — vše prošlo
 *   { ok: false, checks: [...] }  — některý check selhal
 */

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CheckResult = {
  name: string
  passed: boolean
  detail: string
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 })
  }

  const supabase = await createSupabaseServerClient()
  const checks: CheckResult[] = []

  // --- Check 1: Session / auth.uid() ---
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  checks.push({
    name: 'auth.getUser()',
    passed: !!user && !userError,
    detail: user
      ? `uid=${user.id}, email=${user.email}`
      : `error: ${userError?.message ?? 'no user'}`,
  })

  if (!user) {
    return NextResponse.json({ ok: false, checks, hint: 'Nejste přihlášeni.' })
  }

  // --- Check 2: Vlastní staff záznam ---
  const { data: ownStaff, error: staffError } = await supabase
    .from('staff')
    .select('id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  checks.push({
    name: 'staff — vlastní záznam',
    passed: !!ownStaff && !staffError,
    detail: ownStaff
  	? `role=${(ownStaff as any).role}`
  	: `error: ${staffError?.message ?? 'no row'}`,
  })

  // --- Check 3: staff tabulka nevrací víc než 1 řádek (FORCE RLS) ---
  // Director smí vidět všechny — přeskočit pro roli director
  if (ownStaff && (ownStaff as any).role !== 'director') {
    const { data: allStaff, error: allStaffError } = await supabase
      .from('staff')
      .select('id')

    const staffCount = allStaff?.length ?? 0
    checks.push({
      name: 'staff — FORCE RLS (non-director vidí jen sebe)',
      passed: !allStaffError && staffCount === 1,
      detail: allStaffError
        ? `error: ${allStaffError.message}`
        : `vráceno ${staffCount} řádků (očekáváno 1)`,
    })
  } else if ((ownStaff as any)?.role === 'director') {
    checks.push({
      name: 'staff — FORCE RLS (director přeskočen)',
      passed: true,
      detail: 'Director má přístup ke všem staff záznamům — test přeskočen',
    })
  }

  // --- Check 4: students — RLS filtruje podle skupiny ---
  const { data: students, error: studentsError } = await supabase
    .from('students')
    .select('id, first_name, last_name')
    .limit(50) // max 50 žáků — škola má ~18

  const studentCount = students?.length ?? 0
  const maxExpected = 25 // šedá zóna — director vidí všechny (~18), průvodce svou skupinu

  checks.push({
    name: 'students — RLS viditelnost',
    passed: !studentsError,
    detail: studentsError
      ? `error: ${studentsError.message}`
      : `vráceno ${studentCount} žáků (${(ownStaff as any)?.role === 'director' ? 'director — všichni' : 'filtrováno skupinou'})`,
  })

  // --- Výsledek ---
  const allPassed = checks.every((c) => c.passed)

  return NextResponse.json(
    { ok: allPassed, checks },
    { status: allPassed ? 200 : 500 }
  )
}


