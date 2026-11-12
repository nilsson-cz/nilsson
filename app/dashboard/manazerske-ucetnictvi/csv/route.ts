// app/dashboard/manazerske-ucetnictvi/csv/route.ts
// CSV manažerského účetnictví za období (?od=YYYY-MM&do=YYYY-MM) — podklad
// pro model v Google Sheets (PRD §11). Dlouhý formát pro kontingenční tabulku:
// řádek = měsíc × cíl × kategorie × původ; ABRA po dokladech, ostatní zdroje sečtené.
// ';' + BOM + desetinná čárka. Guard: jen director (data navíc chrání RLS mu_*).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadMuReport, resolveMuRange } from '@/lib/manazerske-ucetnictvi/report'
import type { MuFakt } from '@/lib/manazerske-ucetnictvi/fakty'
import { periodKey } from '@/lib/vykaz-ku'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`
  return val
}
const num = (n: number) => n.toFixed(2).replace('.', ',')

const PUVOD: Record<MuFakt['zdroj'], string> = { platby: 'platby', dar: 'dar', dotace: 'narok_dotace', abra: 'abra', preuctovani: 'preuctovani_personalni' }

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  const { data: staff } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if (staff?.role !== 'director') return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const { months, from, to } = resolveMuRange(sp.get('od') ?? undefined, sp.get('do') ?? undefined)

  let report
  try {
    report = await loadMuReport(supabase, months)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  const c = report.ciselniky
  const katById = new Map(c.kategorie.map((k) => [k.id, k]))

  const cilCols = (f: MuFakt): [string, string] => {
    switch (f.cil.kind) {
      case 'cinnost': { const id = f.cil.id; return [c.cinnosti.find((x) => x.id === id)?.nazev ?? '?', ''] }
      case 'akce': { const id = f.cil.id; return ['Akce a granty', c.akce.find((x) => x.id === id)?.nazev ?? '?'] }
      case 'ss': return ['Akce a granty', `${report.ssPopis.get(f.cil.ss) ?? 'Akce'} (SS ${f.cil.ss})`]
      default: return ['Nezařazeno', '']
    }
  }
  const katCols = (id: string | null): [string, string] => {
    const k = id ? katById.get(id) : undefined
    if (!k) return ['', '']
    const p = k.parent_id ? katById.get(k.parent_id) : undefined
    return p ? [p.nazev, k.nazev] : [k.nazev, '']
  }

  type Row = { cols: string[]; castka: number }
  const agg = new Map<string, Row>()
  const abraRows: Row[] = []
  for (const f of report.fakty) {
    const [cinnost, akce] = cilCols(f)
    const [kat, podkat] = katCols(f.kategorieId)
    const base = [f.period, cinnost, akce, kat, podkat, f.typ === 'prijem' ? 'prijem' : 'naklad', 'skutecnost', PUVOD[f.zdroj]]
    if (f.zdroj === 'abra') {
      abraRows.push({ cols: [...base, f.ucet ?? '', f.zakazka ?? '', f.stredisko ?? '', f.doklad ?? ''], castka: f.castka })
    } else {
      const key = base.join('|')
      const row = agg.get(key) ?? { cols: [...base, '', '', '', ''], castka: 0 }
      row.castka += f.castka
      agg.set(key, row)
    }
  }
  // Schválený rozpočet (zdroj 'plan') — stejné sloupce, aby šel v tabulce porovnat se skutečností.
  for (const b of report.plan) {
    const k = katById.get(b.kategorieId)
    if (!k) continue
    const [kat, podkat] = katCols(b.kategorieId)
    const cinnost = c.cinnosti.find((x) => x.id === b.cinnostId)?.nazev ?? '?'
    const base = [b.period, cinnost, '', kat, podkat, k.typ, 'plan', 'rozpocet']
    const key = base.join('|')
    const row = agg.get(key) ?? { cols: [...base, '', '', '', ''], castka: 0 }
    row.castka += b.castka
    agg.set(key, row)
  }
  const rows = [...agg.values(), ...abraRows].sort((a, b) => a.cols.join('|').localeCompare(b.cols.join('|')))

  const header = 'obdobi;cinnost;akce;kategorie;podkategorie;typ;zdroj;puvod;prijem_kc;vydaj_kc;ucet;zakazka;stredisko;doklad'
  const lines = [header, ...rows.map((r) => {
    const [obdobi, cinnost, akce, kat, podkat, typ, zdroj, puvod, ucet, zakazka, stredisko, doklad] = r.cols
    return [obdobi, cinnost, akce, kat, podkat, typ, zdroj, puvod, typ === 'prijem' ? num(r.castka) : '', typ === 'naklad' ? num(r.castka) : '', ucet, zakazka, stredisko, doklad]
      .map((v) => csvEscape(String(v))).join(';')
  })]

  return new NextResponse('﻿' + lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="manazerske-ucetnictvi_${periodKey(from)}_${periodKey(to)}.csv"`,
    },
  })
}
