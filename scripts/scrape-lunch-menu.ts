/**
 * scripts/scrape-lunch-menu.ts
 *
 * Stáhne týdenní jídelníček z webu SOSTP (Jídelna Dobrovolců), naparsuje ho
 * a upsertne do Supabase (lunch_menu_days + lunch_menu_items). Idempotentní –
 * klíčem je menu_date, takže opakované běhy přepíšou data daného dne.
 *
 * Spouští se přes GitHub Actions cron (.github/workflows/lunch-menu.yml).
 * Zápis přes service_role (createClient se service key) → obejde RLS.
 *
 * ENV:
 *   NEXT_PUBLIC_SUPABASE_URL       (povinné)
 *   SUPABASE_SERVICE_ROLE_KEY      (povinné)
 *   DISCORD_LUNCH_WEBHOOK_URL      (volitelné – alerty při chybě/anomálii)
 *   LUNCH_MENU_URL                 (volitelné – override zdrojové URL)
 *
 * Čisté funkce (parseMenuText, extractAllergens, inferWeek) jsou exportované
 * a pokryté testem scripts/scrape-lunch-menu.test.ts.
 */

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const DEFAULT_URL =
  'https://www.sostp.cz/jidelna-dobrovolcu-jidelni-listek';

// ─── pomocné ────────────────────────────────────────────────────────────────

/** Odstraní diakritiku (pro porovnávání názvů dnů nezávisle na háčcích). */
function deburr(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const DAY_INDEX: Record<string, number> = {
  pondeli: 0,
  utery: 1,
  streda: 2,
  ctvrtek: 3,
  patek: 4,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Pondělí ISO týdne, který obsahuje dané datum (ne=0 → předchozí pondělí). */
function mondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=ne .. 6=so
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

// ─── alergeny ────────────────────────────────────────────────────────────────

/**
 * Oddělí koncový blok alergenů (EU čísla 1–14) od popisu.
 * Toleruje rozbité vstupy typu "1,,,7" (vícenásobné čárky) i mezery.
 * Pokud koncový blok obsahuje číslo mimo 1–14, NEbere se jako alergeny
 * (ochrana proti náhodnému číslu na konci názvu).
 */
export function extractAllergens(input: string): {
  text: string;
  allergens: number[];
} {
  const s = input.trim();
  const m = s.match(/\s(\d[\d,\s]*)$/);
  if (!m) return { text: s, allergens: [] };

  const nums = m[1]
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));

  if (nums.length === 0 || nums.some((n) => n < 1 || n > 14)) {
    return { text: s, allergens: [] };
  }

  const allergens = [...new Set(nums)].sort((a, b) => a - b);
  const text = s.slice(0, m.index).replace(/[\s,–-]+$/u, '').trim();
  return { text, allergens };
}

// ─── parser týdne ─────────────────────────────────────────────────────────────

const WEEK_RE =
  /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*[-–—]\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/;

export interface ParsedWeek {
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
}

/**
 * Z hlavičky "15.6. - 19.6." dopočítá rok (rok na stránce není uveden).
 * Bere rok tak, aby týden ležel blízko „teď“; ošetřuje přelom roku.
 * @param now – injektovatelné kvůli testům.
 */
export function inferWeek(
  startDay: number,
  startMonth: number,
  endDay: number,
  endMonth: number,
  now: Date = new Date(),
): ParsedWeek {
  let year = now.getFullYear();
  const candidate = new Date(year, startMonth - 1, startDay);
  const diffDays = (candidate.getTime() - now.getTime()) / 86_400_000;
  if (diffDays < -180) year += 1;
  else if (diffDays > 180) year -= 1;

  const endYear = endMonth < startMonth ? year + 1 : year;
  const start = new Date(year, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  return { weekStart: fmtDate(start), weekEnd: fmtDate(end) };
}

export interface MenuItem {
  option_no: number;
  description: string;
  allergens: number[];
}

export interface MenuDay {
  menu_date: string; // YYYY-MM-DD
  weekday: number; // 1=Po .. 5=Pá
  soup: string | null;
  soup_allergens: number[];
  items: MenuItem[];
  week_start: string;
  week_end: string;
}

export interface ParseResult {
  week: ParsedWeek;
  days: MenuDay[];
  warnings: string[];
}

/**
 * Naparsuje textovou podobu stránky. Stavový automat:
 *  - kotvou je první řádek s rozsahem týdne (díky tomu se přeskočí navigace,
 *    kde jsou taky odkazy „Jídelní lístek“, ale bez data),
 *  - parsuje do dalšího holého nadpisu „Jídelní lístek“ (= prázdná šablona
 *    příštího týdne) nebo do sekce „Nepřehlédněte“,
 *  - do výsledku jdou jen dny s ≥1 položkou (další obrana proti šabloně).
 */
export function parseMenuText(text: string, now: Date = new Date()): ParseResult {
  const warnings: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const anchorIdx = lines.findIndex((l) => WEEK_RE.test(l));
  if (anchorIdx === -1) {
    throw new Error('Nenalezena hlavička týdne (rozsah dat) – změna šablony?');
  }

  const hm = lines[anchorIdx].match(WEEK_RE)!;
  const week = inferWeek(+hm[1], +hm[2], +hm[3], +hm[4], now);
  // Dny jsou vždy indexované Po=0..Pá=4, ale záhlaví („1.9. – 4.9.") nemusí
  // začínat pondělím (první školní týden, týden po svátku…). Kotvíme proto na
  // PONDĚLÍ ISO týdne obsahujícího začátek ze záhlaví — jinak by se všechny
  // datumy posunuly o rozdíl (bug: week_start=úterý 1.9. → menu_date o den napřed).
  const monday = mondayOfWeek(new Date(week.weekStart + 'T00:00:00'));
  const weekStartIso = fmtDate(monday);
  const weekEndIso = fmtDate(addDays(monday, 4)); // pátek téhož týdne

  const byIndex = new Map<
    number,
    { soup: string | null; soup_allergens: number[]; items: MenuItem[] }
  >();
  let current: number | null = null;

  for (let i = anchorIdx + 1; i < lines.length; i++) {
    const line = lines[i];

    if (/^jídelní\s+lístek$/i.test(line)) break; // prázdná šablona dalšího týdne
    if (/neprehlednete/i.test(deburr(line))) break; // sekce pod jídelníčkem

    // den?
    const key = Object.keys(DAY_INDEX).find((k) =>
      deburr(line).toLowerCase().startsWith(k),
    );
    if (key) {
      current = DAY_INDEX[key];
      if (!byIndex.has(current))
        byIndex.set(current, { soup: null, soup_allergens: [], items: [] });
      continue;
    }
    if (current === null) continue;
    const day = byIndex.get(current)!;

    // polévka? (toleruje "- polévka" i slepené "-polévka")
    const noBullet = line.replace(/^[-–—•*]\s*/, '');
    if (/^pol[eé]vka/i.test(deburr(noBullet))) {
      const { text: soupText, allergens } = extractAllergens(noBullet);
      day.soup = soupText;
      day.soup_allergens = allergens;
      continue;
    }

    // položka "1. ..." / "2) ..."
    const im = noBullet.match(/^(\d+)\s*[.)]\s*(.+)$/);
    if (im) {
      const { text: desc, allergens } = extractAllergens(im[2]);
      day.items.push({ option_no: +im[1], description: desc, allergens });
    }
  }

  const days: MenuDay[] = [];
  for (const [idx, data] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    if (data.items.length === 0) continue; // přeskoč prázdné/šablonové dny
    const date = addDays(monday, idx);
    days.push({
      menu_date: fmtDate(date),
      weekday: idx + 1,
      soup: data.soup,
      soup_allergens: data.soup_allergens,
      items: data.items.sort((a, b) => a.option_no - b.option_no),
      week_start: weekStartIso,
      week_end: weekEndIso,
    });
    if (!data.soup) warnings.push(`Den ${fmtDate(date)} nemá polévku.`);
  }

  if (days.length === 0) throw new Error('Naparsováno 0 dní s položkami.');
  if (days.length !== 5)
    warnings.push(`Naparsováno ${days.length} dní (očekáváno 5).`);

  return { week, days, warnings };
}

// ─── HTML → text (cheerio, dynamicky importováno) ─────────────────────────────

async function htmlToText(html: string): Promise<string> {
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  $('br').replaceWith('\n');
  $('p,li,div,tr,h1,h2,h3,h4,h5,strong,b').each((_i, el) => {
    $(el).append('\n');
  });
  return $('body').text();
}

// ─── Discord alert ────────────────────────────────────────────────────────────

async function notifyDiscord(content: string): Promise<void> {
  const url = process.env.DISCORD_LUNCH_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🍲 [jídelníček] ${content}` }),
    });
  } catch {
    /* alert je best-effort */
  }
}

// ─── upsert do Supabase ───────────────────────────────────────────────────────

async function upsert(result: ParseResult, rawText: string): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error('Chybí NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');

  const admin = createClient(url, key, { auth: { persistSession: false } });

  for (const day of result.days) {
    const { data: dayRow, error: dayErr } = await admin
      .from('lunch_menu_days')
      .upsert(
        {
          menu_date: day.menu_date,
          weekday: day.weekday,
          soup: day.soup,
          soup_allergens: day.soup_allergens,
          week_start: day.week_start,
          week_end: day.week_end,
          source_url: process.env.LUNCH_MENU_URL ?? DEFAULT_URL,
          raw_text: rawText.slice(0, 20_000),
          scraped_at: new Date().toISOString(),
        },
        { onConflict: 'menu_date' },
      )
      .select('id')
      .single();
    if (dayErr) throw new Error(`upsert day ${day.menu_date}: ${dayErr.message}`);

    const dayId = (dayRow as { id: string }).id;

    // přepíšeme položky dne (počet voleb se může změnit)
    const { error: delErr } = await admin
      .from('lunch_menu_items')
      .delete()
      .eq('day_id', dayId);
    if (delErr) throw new Error(`delete items ${day.menu_date}: ${delErr.message}`);

    if (day.items.length) {
      const { error: insErr } = await admin.from('lunch_menu_items').insert(
        day.items.map((it) => ({
          day_id: dayId,
          option_no: it.option_no,
          description: it.description,
          allergens: it.allergens,
        })),
      );
      if (insErr) throw new Error(`insert items ${day.menu_date}: ${insErr.message}`);
    }
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const url = process.env.LUNCH_MENU_URL ?? DEFAULT_URL;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NilssonBot/1.0 (+zsvilekula.cz)' },
  });
  if (!res.ok) throw new Error(`Fetch ${url} → HTTP ${res.status}`);
  const html = await res.text();

  const text = await htmlToText(html);
  const result = parseMenuText(text);

  await upsert(result, text);

  const summary = `Uloženo ${result.days.length} dní (${result.week.weekStart}–${result.week.weekEnd}).`;
  console.log(summary);
  if (result.warnings.length) {
    console.warn('Upozornění:\n - ' + result.warnings.join('\n - '));
    await notifyDiscord(`${summary} Upozornění: ${result.warnings.join('; ')}`);
  }
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch(async (err) => {
    console.error(err);
    await notifyDiscord(`❌ Scraper selhal: ${err.message ?? err}`);
    process.exit(1);
  });
}
