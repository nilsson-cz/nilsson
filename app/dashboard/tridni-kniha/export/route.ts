// app/dashboard/tridni-kniha/export/route.ts
// GET ?group_id=…&od=YYYY-MM-DD&do=YYYY-MM-DD → PDF třídní knihy jedné třídy.
// Guard: ředitel / readonly (náhled pro inspekci). Data z lib/tridnice-export/gather,
// render z lib/tridnice-export/pdf.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { gatherTridniceExport } from '@/lib/tridnice-export/gather';
import { renderTridnicePdf } from '@/lib/tridnice-export/pdf';

// react-pdf potřebuje Node runtime; celý rok = ~150 stran → delší limit.
export const runtime = 'nodejs';
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

function asciiSlug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'trida'
  );
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const groupId = sp.get('group_id') ?? '';
  const od = sp.get('od') ?? '';
  const doo = sp.get('do') ?? '';

  if (!UUID.test(groupId) || !ISO.test(od) || !ISO.test(doo) || od > doo) {
    return NextResponse.json({ error: 'Neplatná třída nebo období.' }, { status: 400 });
  }
  const dnu = (Date.parse(doo) - Date.parse(od)) / 86_400_000;
  if (dnu > 366) {
    return NextResponse.json({ error: 'Období může být nejvýš jeden rok.' }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 });
  }
  const { data: staffRaw } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle();
  const role = (staffRaw as { role?: string } | null)?.role;
  if (role !== 'director' && role !== 'readonly') {
    return NextResponse.json({ error: 'Export třídnice může stáhnout jen ředitel.' }, { status: 403 });
  }

  let data;
  try {
    data = await gatherTridniceExport(groupId, od, doo);
  } catch (e) {
    console.error('[tridnice-export] gather:', e);
    return NextResponse.json({ error: 'Sběr dat selhal.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Třída nenalezena.' }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderTridnicePdf(data);
  } catch (e) {
    console.error('[tridnice-export] render:', e);
    return NextResponse.json({ error: 'Generování PDF selhalo.' }, { status: 500 });
  }

  const filename = `tridni-kniha_${asciiSlug(data.trida)}_${od}_${doo}.pdf`;
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
