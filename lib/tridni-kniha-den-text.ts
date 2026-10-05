// lib/tridni-kniha-den-text.ts
// Sdílená vrstva: „text dne" se ODVOZUJE z napojených bloků rozvrhu, nekopíruje se.
// Zdroj pravdy pro obsah dne = rozvrh_blok.obsah (per blok). Kontejnerový
// tridni_kniha_zaznamy.popis je volitelný ruční doplněk nad bloky.
//
// Používá:
//  - app/actions/tridni-kniha.ts → vstup pro AI párování ŠVP (Haiku)
//  - app/dashboard/tridni-kniha/[id]/page.tsx → časová osa obsahu bloků na detailu dne
//
// Vazba blok → den: zapsané (potvrzené) bloky téhož dne, které patří třídě kontejneru
// (rozvrh_blok_skupiny). Spojený blok více tříd (migrace 149) se tak objeví v textu
// dne každé třídy; po odpojení třídy z něj zmizí. rozvrh_blok.tridni_zaznam_id
// ukazuje jen na kontejner vlastníka — zůstává jako záloha pro záznamy bez třídy.

export interface BlokObsah {
  cas_od: string;
  cas_do: string;
  nazev: string;
  obsah: string | null;
}

function orez(t: string | null | undefined): string {
  return (t ?? '').trim();
}

function cas(t: string): string {
  return (t ?? '').slice(0, 5);
}

/**
 * Načte zapsané bloky denního záznamu (mimo zrušené), seřazené dle času.
 * cast `supabase`→`any` — sdílený helper volaný s různě typovanými klienty.
 */
export async function nactiBlokyProZaznam(
  supabase: any,
  zaznamId: string,
): Promise<BlokObsah[]> {
  type Row = { id: string; cas_od: string; cas_do: string; nazev: string; obsah: string | null; stav: string; potvrzeno_at: string | null };
  const cols = 'id, cas_od, cas_do, nazev, obsah, stav, potvrzeno_at';

  const { data: zaznam } = await supabase
    .from('tridni_kniha_zaznamy').select('datum, group_id').eq('id', zaznamId).maybeSingle();

  // Záloha: přímý odkaz (kontejner vlastníka; i záznamy bez třídy).
  const { data: prime } = await supabase.from('rozvrh_blok').select(cols).eq('tridni_zaznam_id', zaznamId);
  const bloky = new Map<string, Row>(((prime ?? []) as Row[]).map((b) => [b.id, b]));

  if (zaznam?.group_id) {
    // Zapsané bloky dne + přímo napojené → ponechat jen ty, které třídě patří
    // (blok, od něhož byla třída odpojena, do jejího textu nepatří).
    const { data: dne } = await supabase
      .from('rozvrh_blok').select(cols).eq('datum', zaznam.datum).not('potvrzeno_at', 'is', null);
    for (const b of (dne ?? []) as Row[]) bloky.set(b.id, b);
    const ids = [...bloky.keys()];
    const { data: skup } = ids.length > 0
      ? await supabase.from('rozvrh_blok_skupiny').select('blok_id').in('blok_id', ids).eq('group_id', zaznam.group_id)
      : { data: [] };
    const patri = new Set(((skup ?? []) as { blok_id: string }[]).map((k) => k.blok_id));
    for (const id of ids) if (!patri.has(id)) bloky.delete(id);
  }

  return [...bloky.values()]
    .filter((b) => b.stav !== 'zruseno')
    .sort((a, b) => a.cas_od.localeCompare(b.cas_od))
    .map((b) => ({
      cas_od: b.cas_od,
      cas_do: b.cas_do,
      nazev: b.nazev,
      obsah: b.obsah ?? null,
    }));
}

/** Má den vůbec nějaký zapsaný obsah (ruční popis nebo aspoň jeden blok s obsahem)? */
export function maObsahDne(popis: string | null, bloky: BlokObsah[]): boolean {
  return orez(popis).length > 0 || bloky.some((b) => orez(b.obsah).length > 0);
}

/**
 * Složí text dne z ručního popisu + řádků bloků (nadpis + obsah).
 * Bloky bez obsahu se uvedou jen názvem (drží informaci „co se učilo").
 * Výstup je čitelný jak pro člověka (detail dne), tak pro model (párování ŠVP).
 */
export function slozTextDne(popis: string | null, bloky: BlokObsah[]): string {
  const casti: string[] = [];

  const p = orez(popis);
  if (p) casti.push(p);

  if (bloky.length > 0) {
    const radky = bloky.map((b) => {
      const hlava = `${cas(b.cas_od)}–${cas(b.cas_do)} ${b.nazev}`.trim();
      const o = orez(b.obsah);
      return o ? `${hlava}: ${o}` : hlava;
    });
    casti.push(['Bloky dne:', ...radky].join('\n'));
  }

  return casti.join('\n\n');
}
