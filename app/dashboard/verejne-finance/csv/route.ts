// app/dashboard/verejne-finance/csv/route.ts
// CSV nároků Veřejných financí za období (?od=YYYY-MM&do=YYYY-MM).
// Dlouhý formát (řádek = měsíc × položka) pro kontingenční tabulku v Excelu;
// ';' + BOM + desetinná čárka → přímé otevření v českém Excelu.
// Guard: jen director (data navíc chrání RLS vf_*).

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import {
  allocateVfPrijato, cellKey, loadVfPrijato, loadVfReport, resolveVfRange, schoolYearOf, ZDROJ_LABEL,
} from '@/lib/verejne-finance'
import { periodKey } from '@/lib/vykaz-ku'

function csvEscape(val: string): string {
  if (val.includes(';') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

/** Číslo s desetinnou čárkou; null → prázdné pole. */
const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '' : n.toFixed(digits).replace('.', ',')

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nejste přihlášeni.' }, { status: 401 })
  const { data: staffRaw } = await supabase
    .from('staff').select('role').eq('user_id', user.id).maybeSingle()
  if ((staffRaw as { role?: string } | null)?.role !== 'director') {
    return NextResponse.json({ error: 'Export je dostupný jen řediteli.' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const { months, from, to } = resolveVfRange(sp.get('od') ?? undefined, sp.get('do') ?? undefined)

  let report
  try {
    report = await loadVfReport(supabase, months)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
  const { params, stav, live, res } = report

  const stavMap = new Map(stav.map((s) => [cellKey(s.period, s.polozka_id), s]))
  const kapMap = new Map(params.kapacity.map((k) => [`${k.izo_id}|${k.skolni_rok}`, k.kapacita]))
  const izoById = new Map(params.izo.map((i) => [i.id, i]))
  const polozky = params.polozky.filter((p) => p.aktivni && izoById.get(p.izo_id)?.aktivni)

  const header = [
    'obdobi', 'izo', 'cinnost', 'polozka', 'jednotka', 'pocet_auto', 'pocet_rucne', 'zdroj_poctu',
    'pocet_financovany', 'kapacita', 'koeficient_pct', 'normativ_rocni', 'normativ_mesicni', 'narok_kc', 'chybi', 'prijato_kc',
  ]
  const lines = [header.join(';')]

  for (const m of months) {
    const period = periodKey(m)
    for (const p of polozky) {
      const c = res.cells.get(cellKey(period, p.id))
      if (!c) continue
      const izo = izoById.get(p.izo_id)!
      const s = stavMap.get(cellKey(period, p.id))
      const auto = s?.pocet_auto ?? live.get(period)?.counts.get(p.id) ?? null
      const kap = p.do_kapacity ? kapMap.get(`${izo.id}|${schoolYearOf(m)}`) ?? null : null
      lines.push([
        period,
        izo.izo ?? '',
        izo.nazev,
        p.nazev,
        p.jednotka === 'zak' ? 'žák' : 'pracovník',
        num(auto),
        num(s?.pocet_rucne),
        c.zdroj ? ZDROJ_LABEL[c.zdroj] : '',
        num(c.financovany),
        num(kap),
        num(c.koeficient, 2),
        num(c.normativRocni, 2),
        num(c.normativRocni == null ? null : c.normativRocni / 12, 2),
        num(c.narok),
        c.chybi.join(', '),
        '',
      ].map((v) => csvEscape(String(v))).join(';'))
    }
  }
  // F2: přijaté platby rozpočtené do měsíců (řádek na měsíc × IZO); bez migrace 136 se vynechají.
  let prijatoSum = 0
  try {
    const alloc = allocateVfPrijato(await loadVfPrijato(supabase), months)
    for (const m of months) {
      const period = periodKey(m)
      for (const [izoKey, castka] of alloc.get(period) ?? []) {
        const izo = izoKey ? izoById.get(izoKey) : undefined
        prijatoSum += castka
        lines.push([
          period, izo?.izo ?? '', izo?.nazev ?? 'bez rozlišení IZO', 'Přijato od KÚ (rozpočteno)',
          '', '', '', '', '', '', '', '', '', '', '', num(castka, 2),
        ].map((v) => csvEscape(String(v))).join(';'))
      }
    }
  } catch {
    // tabulka vf_prijato ještě neexistuje
  }
  lines.push(['CELKEM', '', '', '', '', '', '', '', '', '', '', '', '', num(res.total), '', num(prijatoSum, 2)].join(';'))

  const csvContent = '﻿' + lines.join('\r\n')
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="verejne-finance_${periodKey(from)}_${periodKey(to)}.csv"`,
    },
  })
}
