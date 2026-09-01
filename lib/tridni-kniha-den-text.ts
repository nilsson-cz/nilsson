// lib/tridni-kniha-den-text.ts
// Sdílená vrstva: „text dne" se ODVOZUJE z napojených bloků rozvrhu, nekopíruje se.
// Zdroj pravdy pro obsah dne = rozvrh_blok.obsah (per blok). Kontejnerový
// tridni_kniha_zaznamy.popis je volitelný ruční doplněk nad bloky.
//
// Používá:
//  - app/actions/tridni-kniha.ts → vstup pro AI párování ŠVP (Haiku)
//  - app/dashboard/tridni-kniha/[id]/page.tsx → časová osa obsahu bloků na detailu dne
//
// Vazba blok → den: rozvrh_blok.tridni_zaznam_id (plní ji RPC potvrdit_blok, migrace 065).

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
 * Načte bloky napojené na daný denní záznam (mimo zrušené), seřazené dle času.
 * `supabase as any` — rozvrh_blok.tridni_zaznam_id není v generovaných typech.
 */
export async function nactiBlokyProZaznam(
  supabase: any,
  zaznamId: string,
): Promise<BlokObsah[]> {
  const { data } = await supabase
    .from('rozvrh_blok')
    .select('cas_od, cas_do, nazev, obsah, stav')
    .eq('tridni_zaznam_id', zaznamId)
    .order('cas_od');

  return ((data ?? []) as any[])
    .filter((b) => b.stav !== 'zruseno')
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
