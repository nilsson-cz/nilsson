// app/dashboard/manazerske-ucetnictvi/akce/[id]/csv/route.ts
// CSV jedné akce / grantu za stejné období jako detail (akceObdobi): příjmy sečtené
// po měsíci × původu × kategorii, náklady z ABRA po dokladech (s popisem a firmou),
// personální náklady. ';' + BOM + desetinná čárka. Guard: jen director (data navíc chrání RLS mu_*).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { loadMuReport } from '@/lib/manazerske-ucetnictvi/report'
import { cilKey, type MuFakt } from '@/lib/manazerske-ucetnictvi/fakty'
import { loadAbraDetail } from '../../../_abra-detail'
import { akceObdobi } from '../../../_lib'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) return `"${val.replace(/"/g, '""')}"`
  return val
}
const num = (n: number) => n.toFixed(2).replace('.', ',')

const PUVOD: Record<MuFakt['zdroj'], string> = { platby: 'platby', dar: 'dar', dotace: 'narok_dotace', abra: 'abra', preuctovani: 'preuctovani_personalni' }

/** Název souboru bez diakritiky a mezer. */
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'akce'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  const { data: staff } = await supabase.from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if (staff?.role !== 'director') return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })

  const { id } = await params
  const { data: akceRow } = await supabase.from('mu_akce').select('id, nazev, datum_od, datum_do').eq('id', id).maybeSingle()
  if (!akceRow) return NextResponse.json({ error: 'Akce nenalezena.' }, { status: 404 })
  const { odP, doP, months } = await akceObdobi(supabase)

  let report
  try {
    report = await loadMuReport(supabase, months)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  const c = report.ciselniky
  const katById = new Map(c.kategorie.map((k) => [k.id, k]))
  const katCols = (kid: string | null): [string, string] => {
    const k = kid ? katById.get(kid) : undefined
    if (!k) return ['', '']
    const p = k.parent_id ? katById.get(k.parent_id) : undefined
    return p ? [p.nazev, k.nazev] : [k.nazev, '']
  }

  const fakty = report.fakty.filter((f) => cilKey(f.cil) === `a:${id}`)
  // Výnosy z ABRA u akce s SS — jen kontrolně (typ prijem_kontrolni, do výsledku nepatří).
  const kontrolni = report.kontrolniVynosy.filter((f) => cilKey(f.cil) === `a:${id}`)
  const detail = await loadAbraDetail(supabase, [...fakty.filter((f) => f.zdroj === 'abra'), ...kontrolni].map((f) => Number(f.ref?.id)))

  type Row = { cols: string[]; castka: number }
  const agg = new Map<string, Row>()
  const abraRows: Row[] = []
  for (const f of [...fakty, ...kontrolni]) {
    const [kat, podkat] = katCols(f.kategorieId)
    const typ = kontrolni.includes(f) ? 'prijem_kontrolni' : f.typ === 'prijem' ? 'prijem' : 'naklad'
    const base = [f.period, typ, PUVOD[f.zdroj], kat, podkat]
    if (f.zdroj === 'abra') {
      const d = detail.get(Number(f.ref?.id))
      abraRows.push({
        cols: [...base, f.doklad ?? '', d?.popis ?? '', d?.firma ?? '', f.ucet ?? '', f.zakazka ?? '', f.stredisko ?? '', f.rozdeleno ? 'ano' : ''],
        castka: f.castka,
      })
    } else {
      const key = base.join('|')
      const row = agg.get(key) ?? { cols: [...base, '', '', '', '', '', '', ''], castka: 0 }
      row.castka += f.castka
      agg.set(key, row)
    }
  }
  const rows = [...agg.values(), ...abraRows].sort((a, b) => a.cols.join('|').localeCompare(b.cols.join('|')))

  const header = 'obdobi;typ;puvod;kategorie;podkategorie;prijem_kc;vydaj_kc;kontrolni_kc;doklad;popis;firma;ucet;zakazka;stredisko;cast_rozdeleni'
  const lines = [header, ...rows.map((r) => {
    const [obdobi, typ, puvod, kat, podkat, ...zbytek] = r.cols
    const kc = (t: string) => (typ === t ? num(r.castka) : '')
    return [obdobi, typ, puvod, kat, podkat, kc('prijem'), kc('naklad'), kc('prijem_kontrolni'), ...zbytek].map((v) => csvEscape(String(v))).join(';')
  })]

  return new NextResponse('﻿' + lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="akce_${slug(akceRow.nazev)}_${odP}_${doP}.csv"`,
    },
  })
}
