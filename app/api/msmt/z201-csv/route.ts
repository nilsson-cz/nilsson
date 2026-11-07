/**
 * app/api/msmt/z201-csv/route.ts
 *
 * GET /api/msmt/z201-csv?rok=2026
 *
 * CSV výkazu Z 2-01 (školní družina, stav k 31. 10.) pro načtení ve
 * sberdat.uiv.cz. Hodnoty stejné jako na stránce /dashboard/msmt/z201:
 * zmrazený odevzdaný stav, jinak živý výpočet + ruční přepisy.
 * Formát: lib/vykaz-z201-csv.ts. Kdyby sberdat soubor nenačetl (neznámý
 * stát, překročené meze…), vrací 422 se seznamem chyb.
 *
 * Env: MSMT_IZOV_Z201 (IZO výkazu; default = MSMT_IZO_DRUZINA).
 * Director-only — oddíly V a IX obsahují údaje o zdravotním postižení.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { nactiVstupZ201 } from '@/lib/vykaz-z201-data'
import { aplikujPrepisy, bunkyZ201, vypocetZ201, type Bunky, type Prepis } from '@/lib/vykaz-z201'
import { csvZ201 } from '@/lib/vykaz-z201-csv'
import { msmtEnv } from '@/lib/msmt-env'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 })
  const { data: staff } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if (staff?.role !== 'director') return NextResponse.json({ error: 'Přístup zamítnut' }, { status: 403 })

  const rok = Number(request.nextUrl.searchParams.get('rok'))
  if (!Number.isInteger(rok) || rok < 2026 || rok > 2100) {
    return NextResponse.json({ error: 'Neplatný rok.' }, { status: 400 })
  }

  let b: Bunky
  try {
    const { data: zaznam, error } = await supabase.from('vykaz_z201')
      .select('prepisy, hodnoty, zmrazeno_at').eq('rok', rok).maybeSingle()
    if (error) throw new Error(error.message)
    if (zaznam?.zmrazeno_at) {
      b = (zaznam.hodnoty ?? {}) as unknown as Bunky
    } else {
      const prepisy = ((zaznam?.prepisy ?? {}) as unknown) as Record<string, Prepis>
      b = aplikujPrepisy(bunkyZ201(vypocetZ201(await nactiVstupZ201(supabase, rok))), prepisy)
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const csv = csvZ201(b, msmtEnv().izovZ201, rok)
  if (csv.chyby.length) {
    return NextResponse.json({ error: 'CSV by sberdat nenačetl.', chyby: csv.chyby }, { status: 422 })
  }

  // UTF-8 s BOM jako vzorový soubor ze sberdat (Z2_hodnoty.csv).
  const data = new TextEncoder().encode('﻿' + csv.obsah)
  return new NextResponse(data.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csv.nazevSouboru}"`,
      'Content-Length': String(data.length),
      'Cache-Control': 'no-store',
    },
  })
}
