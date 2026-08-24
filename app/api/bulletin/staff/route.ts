// app/api/bulletin/staff/route.ts
// GET /api/bulletin/staff
// Seznam aktivních zaměstnanců pro picker příjemců bulletinu.
// Guard: jen personál. Zdroj: bulletin_active_staff() (SECDEF RPC).

import { NextResponse }   from 'next/server';
import { requireStaff }   from '@/lib/api-auth';
import { listActiveStaff } from '@/lib/bulletin/recipients';

export async function GET() {
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;

  try {
    const staff = await listActiveStaff();
    return NextResponse.json({ staff, total_count: staff.length });
  } catch (err) {
    console.error('[bulletin/staff GET] Error:', err);
    return NextResponse.json(
      { error: 'Nepodařilo se načíst zaměstnance' },
      { status: 500 },
    );
  }
}
