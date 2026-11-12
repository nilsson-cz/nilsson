// app/dashboard/manazerske-ucetnictvi/kontrola/csv/route.ts
// CSV nespárovaných bankovních pohybů z Kontroly (?rok=YYYY, jako stránka): obě strany v jednom
// souboru — „banka_bez_uctu" (FIO bez dokladu v ABRA), „banka_nezauctovano" (FIO s nezaúčtovaným
// bankovním dokladem ABRA) a „ucetnictvi_bez_banky" (doklad ABRA bez pohybu FIO). ';' + BOM + desetinná čárka. Guard: jen director (data navíc chrání RLS mu_*).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadKontrola } from '@/lib/manazerske-ucetnictvi/kontrola-server'
import { abraConfigFromEnv, abraDokladUrl } from '@/lib/manazerske-ucetnictvi/abra-client'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`
  return val
}
const num = (n: number) => n.toFixed(2).replace('.', ',')

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  const { data: staff } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if (staff?.role !== 'director') return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })

  const rokParam = req.nextUrl.searchParams.get('rok')
  const rok = rokParam && /^\d{4}$/.test(rokParam) ? Number(rokParam) : undefined

  let k
  try {
    k = await loadKontrola(supabase, rok)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  const cfg = abraConfigFromEnv()

  const rows: string[][] = [
    ...k.pohyby.jenFio.map((f) => [
      'banka_bez_uctu', f.datum, num(f.castka), f.protistrana ?? '', f.poznamka ?? '', '', '', '', f.cerstvy ? 'ano' : '', '',
    ]),
    ...k.pohyby.nezauctovano.map(({ fio: f, doklad: d }) => {
      const url = cfg ? abraDokladUrl(cfg, 'banka', Number(d.key.split('|')[1])) : null
      return ['banka_nezauctovano', f.datum, num(f.castka), f.protistrana ?? '', f.poznamka ?? '', d.doklad ?? '', d.popis ?? '', d.firma ?? '', f.cerstvy ? 'ano' : '', url ?? '']
    }),
    ...k.pohyby.jenAbra.map((d) => {
      const [path, id] = d.key.split('|')
      const url = cfg && id ? abraDokladUrl(cfg, path, Number(id)) : null
      return ['ucetnictvi_bez_banky', d.datum, num(d.castka), '', '', d.doklad ?? '', d.popis ?? '', d.firma ?? '', '', url ?? '']
    }),
  ].sort((a, b) => a[0].localeCompare(b[0]) || b[1].localeCompare(a[1]))

  const header = 'strana;datum;castka_kc;protistrana;poznamka;doklad;popis;firma;cerstvy;odkaz_abra'
  const lines = [header, ...rows.map((r) => r.map((v) => csvEscape(v)).join(';'))]

  return new NextResponse('﻿' + lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kontrola_banka_nesparovane_${k.rok}.csv"`,
    },
  })
}
