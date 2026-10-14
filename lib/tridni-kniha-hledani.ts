// lib/tridni-kniha-hledani.ts
// Úryvky a zvýraznění pro vyhledávání v třídnici (RPC hledej_v_tridnici, migrace 153).
// Shoda je jako v SQL: bez diakritiky a velikosti písmen, po slovech.

export type Usek = { text: string; shoda: boolean };

/**
 * Znak (code point) bez diakritiky, malým písmenem (ř→r, Á→a). Vždy právě jedna
 * UTF-16 jednotka, aby indexy v normalizovaném textu odpovídaly pozicím znaků
 * (emoji apod. → zástupný \u0000, ten se s dotazem nikdy nespáruje).
 */
function zakladni(ch: string): string {
  const z = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return z.length === 1 ? z : '\u0000';
}

export function slovaDotazu(q: string): string[] {
  return [...new Set(
    q.trim().split(/\s+/).map((s) => [...s].map(zakladni).join('')).filter(Boolean),
  )];
}

/** Rozsahy [od, do) všech výskytů slov v textu (sloučené, seřazené). */
function rozsahy(text: string, slova: string[]): [number, number][] {
  const norm = [...text].map(zakladni).join('');
  const r: [number, number][] = [];
  for (const s of slova) {
    let i = norm.indexOf(s);
    while (i !== -1) {
      r.push([i, i + s.length]);
      i = norm.indexOf(s, i + s.length);
    }
  }
  r.sort((a, b) => a[0] - b[0]);
  const slouc: [number, number][] = [];
  for (const x of r) {
    const posl = slouc[slouc.length - 1];
    if (posl && x[0] <= posl[1]) posl[1] = Math.max(posl[1], x[1]);
    else slouc.push([...x]);
  }
  return slouc;
}

/**
 * Úryvek kolem první shody (±kontext znaků) rozdělený na zvýrazněné/nezvýrazněné úseky.
 * Krátký text vrací celý. Bez shody vrací začátek textu.
 */
export function uryvek(text: string, slova: string[], kontext = 90): Usek[] {
  const znaky = [...text.replace(/\s+/g, ' ').trim()];
  const t = znaky.join('');
  const r = rozsahy(t, slova);

  let od = 0;
  let doo = znaky.length;
  if (znaky.length > kontext * 2) {
    const prvni = r[0]?.[0] ?? 0;
    od = Math.max(0, prvni - kontext);
    doo = Math.min(znaky.length, od + kontext * 2);
  }

  const vysledek: Usek[] = [];
  if (od > 0) vysledek.push({ text: '…', shoda: false });
  let i = od;
  for (const [a, b] of r) {
    if (b <= od || a >= doo) continue;
    const aa = Math.max(a, od);
    const bb = Math.min(b, doo);
    if (aa > i) vysledek.push({ text: znaky.slice(i, aa).join(''), shoda: false });
    vysledek.push({ text: znaky.slice(aa, bb).join(''), shoda: true });
    i = bb;
  }
  if (i < doo) vysledek.push({ text: znaky.slice(i, doo).join(''), shoda: false });
  if (doo < znaky.length) vysledek.push({ text: '…', shoda: false });
  return vysledek;
}
