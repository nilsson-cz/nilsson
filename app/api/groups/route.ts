// app/api/groups/route.ts — NÁHRADA CELÉHO SOUBORU
// Změna: výchozí dotaz vrací ACTIVE_SCHOOL_YEARS (obě třídy v přechodném období)
// Zachována zpětná kompatibilita: ?school_year=2025%2F2026 stále funguje

import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/api-auth';
import { CURRENT_SCHOOL_YEAR, ACTIVE_SCHOOL_YEARS } from '@/lib/config';

export async function GET(req: NextRequest) {
  // Druhý zámek k RLS: seznam skupin je jen pro personál. (nález 4.4)
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;
  const { supabase } = guard;

  const { searchParams } = req.nextUrl;

  const schoolYearParam = searchParams.get('school_year');

  let query = supabase
    .from('groups')
    .select('id, name, school_year');

  if (schoolYearParam && schoolYearParam !== 'current' && schoolYearParam !== 'active') {
    // Explicitní rok — filtrovat přesně
    query = query.eq('school_year', schoolYearParam);
  } else if (schoolYearParam === 'current') {
    // Zpětná kompatibilita: ?school_year=current → jen aktuální rok
    query = query.eq('school_year', CURRENT_SCHOOL_YEAR);
  } else {
    // Výchozí (žádný param, nebo ?school_year=active) → přechodné období
    query = query.in('school_year', ACTIVE_SCHOOL_YEARS as unknown as string[]);
  }

  const { data, error } = await query
    .order('school_year', { ascending: false })  // 2026/2027 první
    .order('name', { ascending: true });

  if (error) {
    console.error('[api/groups GET] Error:', error);
    return NextResponse.json({ error: 'Nepodařilo se načíst skupiny' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
