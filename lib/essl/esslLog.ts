// lib/essl/esslLog.ts
//
// Typovaný helper pro zápis do auditní stopy eSSL (RPC essl_log).
//
// Proč existuje (viz ARCH-NOTES §91):
//  - p_operace je otypované jako Database['public']['Enums']['essl_operace'],
//    takže NEPLATNÁ hodnota je COMPILE chyba (ne runtime tiché selhání) — to
//    je pravá příčina, proč bugy §91 prošly ('dokument_zaevidovan',
//    'dokument_prirazen_spisu' v enumu nejsou → rpc() tiše selhalo).
//  - Návratová chyba z rpc() se VŽDY kontroluje a zviditelní (console.error
//    + vrácený { error }), takže audit nikdy neselže potichu.
//
// essl_transakce je zákonná append-only stopa (vyhl. 259/2012 § 17 odst. 2) —
// tiché selhání auditu je nepřípustné.

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'

export type EsslOperace = Database['public']['Enums']['essl_operace']

/**
 * Argumenty RPC essl_log. 1:1 s generovanou signaturou v types/database.ts.
 * p_operace je povinné a otypované enumem → neplatná hodnota = compile chyba.
 */
export type EsslLogArgs = {
  p_operace: EsslOperace
  p_dokument_id?: string
  p_spis_id?: string
  p_skartacni_navrh_id?: string
  p_detail?: Json
  p_uzivatel_popis_override?: string
}

/**
 * Zapíše auditní záznam do essl_transakce přes RPC essl_log.
 *
 * Chybu NIKDY nepolyká: zaloguje ji (console.error) a vrátí v { error },
 * aby ji volající mohl zviditelnit uživateli. Volající se má o { error }
 * postarat (banner / warning), ať auditní díra není neviditelná.
 *
 * @param supabase  Supabase klient (browser i server).
 * @param args      Argumenty essl_log; p_operace enumem otypované.
 * @returns         { error } — null při úspěchu, jinak PostgrestError.
 */
export async function esslLog(
  supabase: SupabaseClient<Database>,
  args: EsslLogArgs,
): Promise<{ error: PostgrestError | null }> {
  const { error } = await supabase.rpc('essl_log', args)
  if (error) {
    console.error(
      `[esslLog] Auditní záznam se NEZAPSAL ` +
        `(operace=${args.p_operace}, dokument=${args.p_dokument_id ?? '—'}, ` +
        `spis=${args.p_spis_id ?? '—'}): ${error.message}`,
      error,
    )
  }
  return { error }
}
