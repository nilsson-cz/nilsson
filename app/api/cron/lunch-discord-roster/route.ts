/**
 * app/api/cron/lunch-discord-roster/route.ts
 *
 * Ranní Discord report: jídelníček dne + seznam VŠECH dětí, které mají DNES oběd.
 * Samostatná routa (nezávislá na SMS reportu jídelně) — spouští ji cron-job.org
 * po–pá kolem 06:00 Europe/Prague, chráněno CRON_SECRET (stejný vzor jako
 * /api/cron/lunch-report). Lze spustit i ručně: GET /api/cron/lunch-discord-roster.
 *
 * Chování:
 *   - běží jen pro ŠKOLNÍ den (víkend/prázdniny/ř. volno → skip, lunch_is_school_day),
 *   - pošle DVĚ zprávy stejným webhookem: (1) jídelníček dne (lunch_menu_days +
 *     lunch_menu_items — polévka + varianty + alergeny), (2) roster strávníků,
 *   - jídelníček je volitelný: když pro dnešek není naparsovaný, přeskočí se a
 *     roster jde stejně (response nese `menu: false`),
 *   - roster = lunch_day_roster_report(dnes) = přesně to, co jde v ranní SMS jídelně
 *     (objednáno, bez omluvenky do uzávěrky 22:00 D-1), seskupený po třídách,
 *   - každá zpráva se při >~1900 znacích rozdělí (limit Discordu je 2000 / zpráva),
 *   - ve školní den posílá i „0 dětí" (jednoznačné, že report proběhl).
 *
 * Env: CRON_SECRET (ochrana), DISCORD_LUNCH_ROSTER_WEBHOOK_URL (cíl — NIKDY v kódu).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DISCORD_CHARS = 1900 // rezerva pod tvrdý limit 2000

type RosterRow = { student_id: string; first_name: string; last_name: string; trida: string | null }
type MenuItem = { option_no: number; description: string; allergens: number[] }
type MenuDay = { soup: string | null; soup_allergens: number[]; items: MenuItem[] }

/** Aktuální datum (YYYY-MM-DD) v pásmu Europe/Prague. */
function pragueDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** DD.MM.YYYY z ISO data (bez posunu časového pásma). */
function formatCZ(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

/** Sestaví text reportu (seskupeno po třídách, řazení už z DB). */
function buildMessage(dateIso: string, rows: RosterRow[]): string {
  const header = `🍽️ **Obědy ${formatCZ(dateIso)}** — ${rows.length} ${rows.length === 1 ? 'dítě' : 'dětí'}`
  if (rows.length === 0) return `${header}\n_Dnes nikdo nemá objednaný oběd._`

  const byClass = new Map<string, RosterRow[]>()
  for (const r of rows) {
    const key = r.trida?.trim() || 'Bez třídy'
    const arr = byClass.get(key) ?? []
    arr.push(r)
    byClass.set(key, arr)
  }

  const blocks: string[] = []
  for (const [trida, list] of byClass) {
    const lines = list.map((r) => `• ${r.last_name} ${r.first_name}`).join('\n')
    blocks.push(`**${trida}** (${list.length})\n${lines}`)
  }
  return `${header}\n\n${blocks.join('\n\n')}`
}

/** EU čísla alergenů (1–14) → „ (1, 3, 7)"; prázdné → prázdný řetězec. */
function alerg(a: number[] | null | undefined): string {
  return a && a.length ? ` (${a.join(', ')})` : ''
}

/** Sestaví text jídelníčku dne (polévka + varianty + alergeny). '' = nic k zobrazení. */
function buildMenuMessage(dateIso: string, menu: MenuDay): string {
  const lines: string[] = []
  if (menu.soup) lines.push(`🍲 Polévka: ${menu.soup}${alerg(menu.soup_allergens)}`)
  for (const it of menu.items) lines.push(`${it.option_no}. ${it.description}${alerg(it.allergens)}`)
  if (lines.length === 0) return ''
  return `📋 **Jídelníček ${formatCZ(dateIso)}**\n${lines.join('\n')}`
}

/** Načte jídelníček dne (2 tabulky). null = pro dnešek není naparsovaný. */
async function fetchMenu(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  today: string,
): Promise<MenuDay | null> {
  const { data: day } = await supabase
    .from('lunch_menu_days')
    .select('id, soup, soup_allergens')
    .eq('menu_date', today)
    .maybeSingle()
  if (!day) return null
  const d = day as { id: string; soup: string | null; soup_allergens: number[] | null }

  const { data: itemsRaw } = await supabase
    .from('lunch_menu_items')
    .select('option_no, description, allergens')
    .eq('day_id', d.id)
    .order('option_no')

  return {
    soup: d.soup,
    soup_allergens: d.soup_allergens ?? [],
    items: ((itemsRaw ?? []) as any[]).map((i) => ({
      option_no: i.option_no,
      description: i.description,
      allergens: (i.allergens ?? []) as number[],
    })),
  }
}

/** Rozdělí zprávu na kusy pod limit Discordu — dělí po řádcích, nikdy neřeže řádek. */
function chunk(message: string, limit = MAX_DISCORD_CHARS): string[] {
  if (message.length <= limit) return [message]
  const out: string[] = []
  let cur = ''
  for (const line of message.split('\n')) {
    if (cur && cur.length + 1 + line.length > limit) {
      out.push(cur)
      cur = ''
    }
    // Jediný řádek delší než limit (nemělo by nastat) — tvrdě ořízni.
    if (line.length > limit) {
      if (cur) { out.push(cur); cur = '' }
      for (let i = 0; i < line.length; i += limit) out.push(line.slice(i, i + limit))
      continue
    }
    cur = cur ? `${cur}\n${line}` : line
  }
  if (cur) out.push(cur)
  return out
}

async function postDiscord(url: string, content: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Discord ${res.status}: ${body.slice(0, 300)}`)
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const webhook = process.env.DISCORD_LUNCH_ROSTER_WEBHOOK_URL
  if (!webhook) {
    return NextResponse.json({ error: 'Chybí DISCORD_LUNCH_ROSTER_WEBHOOK_URL.' }, { status: 500 })
  }

  const supabase = createSupabaseAdmin()
  const today = pragueDate()

  // 1) Neškolní den → neposílat (víkend/prázdniny/ř. volno)
  const { data: schoolDay, error: sdErr } = await supabase.rpc('lunch_is_school_day', { p_date: today })
  if (sdErr) {
    return NextResponse.json({ error: `is_school_day: ${sdErr.message}` }, { status: 500 })
  }
  if (!schoolDay) {
    return NextResponse.json({ skipped: true, reason: 'Neškolní den.', date: today })
  }

  // 2) Jídelníček dne (volitelný — nemusí být naparsovaný)
  const menu = await fetchMenu(supabase, today)
  const menuMsg = menu ? buildMenuMessage(today, menu) : ''

  // 3) Roster strávníků dne (RPC zatím není v types → cast; db:types po migraci 107).
  const { data, error } = await (supabase.rpc as any)('lunch_day_roster_report', { p_date: today })
  if (error) {
    return NextResponse.json({ error: `roster: ${error.message}` }, { status: 500 })
  }
  const rows = (data ?? []) as RosterRow[]

  // 4) Odeslání na Discord: nejdřív jídelníček, pak roster (obojí po částech <2000 znaků).
  try {
    const messages: string[] = []
    if (menuMsg) messages.push(...chunk(menuMsg))
    messages.push(...chunk(buildMessage(today, rows)))
    for (const m of messages) await postDiscord(webhook, m)
    return NextResponse.json({
      ok: true, date: today, count: rows.length, menu: Boolean(menuMsg), messages: messages.length,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, date: today, count: rows.length, menu: Boolean(menuMsg), error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
