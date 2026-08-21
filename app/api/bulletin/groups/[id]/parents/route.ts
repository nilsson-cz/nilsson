// app/api/bulletin/groups/[id]/parents/route.ts
// GET /api/bulletin/groups/[id]/parents
// Preview příjemců pro UI před odesláním příspěvku.
// Query params:
//   school_year?          – výchozí CURRENT_SCHOOL_YEAR
//   excluded?             – čárkami oddělené guardian_id k vyloučení
//   extra_group_ids?      – čárkami oddělené další group_id (pro multi-select)

import { NextRequest, NextResponse } from 'next/server';
import { requireStaff }              from '@/lib/api-auth';
import { resolveRecipients }         from '@/lib/bulletin/recipients';
import { CURRENT_SCHOOL_YEAR }       from '@/lib/config';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
) {
  // Guard: preview příjemců je jen pro personál. RPC bulletin_resolve_recipients
  // je SECURITY DEFINER (obchází RLS), takže bez tohoto checku by ji zavolal
  // kterýkoli přihlášený rodič a dostal jména + e-maily všech ZZ třídy. (nález 4.1)
  const guard = await requireStaff();
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = req.nextUrl;

  const { id: primaryGroupId } = await params;
  const schoolYear      = searchParams.get('school_year') ?? CURRENT_SCHOOL_YEAR;

  // Podpora pro multi-select: primární skupina + případné extra skupiny
  const extraGroupIdsRaw = searchParams.get('extra_group_ids') ?? '';
  const extraGroupIds    = extraGroupIdsRaw
    ? extraGroupIdsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const allGroupIds = [primaryGroupId, ...extraGroupIds].filter(Boolean);

  // Vyloučení konkrétních zákonných zástupců
  const excludedRaw      = searchParams.get('excluded') ?? '';
  const excludedGuardianIds = excludedRaw
    ? excludedRaw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  try {
    const recipients = await resolveRecipients(
      allGroupIds,
      excludedGuardianIds,
      schoolYear,
    );

    const missingEmailCount = recipients.filter(r => !r.hasEmail).length;

    return NextResponse.json({
      recipients,
      total_count:        recipients.length,
      missing_email_count: missingEmailCount,
      has_email_count:    recipients.length - missingEmailCount,
    });
  } catch (err) {
    console.error('[bulletin/groups/[id]/parents GET] Error:', err);
    return NextResponse.json(
      { error: 'Nepodařilo se načíst příjemce' },
      { status: 500 },
    );
  }
}
