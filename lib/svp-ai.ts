// lib/svp-ai.ts
// Server-only vrstva pro AI párování ŠVP výstupů (PRD-svp-ai-parovani-2026-08-03).
// Volá Claude Haiku 4.5 přes oficiální @anthropic-ai/sdk. Klíč v env ANTHROPIC_API_KEY.
//
// Model vrací KÓDY výstupů (svp_vystupy.kod je stabilní a unikátní) — server action si
// je pak zmapuje na vystup_id + rocnik a tvrdě zvaliduje proti dodanému číselníku.

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export const SVP_AI_MODEL = 'claude-haiku-4-5';

export interface SvpKandidat {
  id: string;
  kod: string;
  rocnik: number;
  predmet: string;
  vystup_text: string;
}

export interface SvpZaznamVstup {
  nazev: string;
  typ_zaznamu: string;
  datum: string;
  popis: string;
}

export interface SvpNavrhModel {
  kod: string;
  jistota: number;
  zduvodneni: string;
}

const SYSTEM = [
  'Jsi pedagogický asistent v české základní škole (ZŠ Vilekula).',
  'Úkol: k zápisu jednoho dne ve třídě přiřaď výstupy ŠVP z DODANÉHO ČÍSELNÍKU.',
  '',
  'Pravidla:',
  '- Vybírej VÝHRADNĚ výstupy z dodaného číselníku, a to podle jejich kódu.',
  '  Nikdy nevymýšlej kódy ani výstupy, které v číselníku nejsou.',
  '- Přiřaď jen výstupy, které mají jasnou oporu v textu zápisu. Když si nejsi jistý,',
  '  raději nepřiřazuj — lepší méně a přesně než hodně a chybně.',
  '- Ke každému návrhu uveď stručné zdůvodnění (1 věta) odkazující na konkrétní část',
  '  zápisu a míru jistoty 0–100.',
  '- Pokud v zápisu není nic, co by šlo smysluplně napárovat, vrať prázdný seznam.',
  '',
  'Odpovídej výhradně voláním nástroje navrhni_vystupy.',
].join('\n');

const TOOL: Anthropic.Tool = {
  name: 'navrhni_vystupy',
  description:
    'Vrátí navržené ŠVP výstupy (podle jejich kódu z číselníku) k zápisu dne. ' +
    'Prázdný seznam, pokud nic nesedí.',
  input_schema: {
    type: 'object',
    properties: {
      navrhy: {
        type: 'array',
        description: 'Seznam navržených výstupů; může být prázdný.',
        items: {
          type: 'object',
          properties: {
            kod: { type: 'string', description: 'Kód výstupu z číselníku (např. M-3-05).' },
            jistota: { type: 'integer', description: 'Míra jistoty 0–100.' },
            zduvodneni: { type: 'string', description: 'Jedna věta odkazující na text zápisu.' },
          },
          required: ['kod', 'jistota', 'zduvodneni'],
        },
      },
    },
    required: ['navrhy'],
  },
};

/**
 * Zavolá model a vrátí surové návrhy (kód + jistota + zdůvodnění).
 * Validaci kódů proti číselníku a mapování na vystup_id řeší volající (server action).
 * Vyhodí, pokud volání API selže nebo chybí klíč.
 */
export async function navrhniSvpVystupy(
  zaznam: SvpZaznamVstup,
  kandidati: SvpKandidat[],
): Promise<SvpNavrhModel[]> {
  if (kandidati.length === 0) return [];

  const anthropic = new Anthropic(); // čte ANTHROPIC_API_KEY z env

  const ciselnik = kandidati
    .map((k) => `${k.kod} · ${k.predmet} · ${k.rocnik}. ročník · ${k.vystup_text}`)
    .join('\n');

  const userText = [
    'ZÁPIS DNE',
    `Název: ${zaznam.nazev}`,
    `Typ: ${zaznam.typ_zaznamu}`,
    `Datum: ${zaznam.datum}`,
    'Popis:',
    zaznam.popis,
    '',
    'ČÍSELNÍK KANDIDÁTNÍCH VÝSTUPŮ (formát: kód · předmět · ročník · text):',
    ciselnik,
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: SVP_AI_MODEL,
    max_tokens: 2048,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'navrhni_vystupy' },
    messages: [{ role: 'user', content: userText }],
  });

  const block = resp.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') return [];

  const input = block.input as { navrhy?: unknown };
  if (!Array.isArray(input.navrhy)) return [];

  const out: SvpNavrhModel[] = [];
  for (const n of input.navrhy) {
    if (!n || typeof n !== 'object') continue;
    const kod = (n as any).kod;
    if (typeof kod !== 'string' || !kod.trim()) continue;
    const jistotaRaw = Number((n as any).jistota);
    const jistota = Number.isFinite(jistotaRaw)
      ? Math.max(0, Math.min(100, Math.round(jistotaRaw)))
      : 0;
    const zduvodneni = typeof (n as any).zduvodneni === 'string' ? (n as any).zduvodneni : '';
    out.push({ kod: kod.trim(), jistota, zduvodneni });
  }
  return out;
}
