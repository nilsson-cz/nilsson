-- ============================================================================
-- 037_essl_isds.sql
-- eSSL fáze 2: automatizace napojení na ISDS (datová schránka)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. essl_log — přidání volitelného přepisu popisu uživatele
--    (pro automatické zápisy z cron jobů, odlišit od ručních akcí)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.essl_log(
  p_operace essl_operace,
  p_dokument_id uuid DEFAULT NULL::uuid,
  p_spis_id uuid DEFAULT NULL::uuid,
  p_skartacni_navrh_id uuid DEFAULT NULL::uuid,
  p_detail jsonb DEFAULT '{}'::jsonb,
  p_uzivatel_popis_override text DEFAULT NULL
 )
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO essl_transakce (
    operace, dokument_id, spis_id, skartacni_navrh_id,
    uzivatel_id, uzivatel_popis, detail
  )
  SELECT
    p_operace,
    p_dokument_id,
    p_spis_id,
    p_skartacni_navrh_id,
    auth.uid(),
    COALESCE(
      p_uzivatel_popis_override,
      (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = auth.uid()),
      (SELECT email FROM auth.users WHERE id = auth.uid()),
      'systém'
    ),
    p_detail;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. ds_zpravy — raw ISDS payload, dedup přes ds_zprava_id,
--    stav zpracování, link na výsledný dokumenty.id
-- ----------------------------------------------------------------------------

CREATE TABLE ds_zpravy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ds_zprava_id bigint NOT NULL UNIQUE,
  typ_zpravy text,                      -- 'dodejka' / 'zprava' dle ISDS
  odesilatel_nazev text,
  odesilatel_id_ds text,
  predmet text,
  datum_dodani timestamptz,
  raw_payload jsonb NOT NULL,
  zpracovano boolean NOT NULL DEFAULT false,
  dokument_id uuid REFERENCES dokumenty(id),
  chyba text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ds_zpravy_nezpracovane
  ON ds_zpravy (zpracovano)
  WHERE zpracovano = false;

COMMENT ON TABLE ds_zpravy IS
  'Raw ISDS zprávy stažené cron jobem (essl-isds-poll). zpracovano=false → čeká na namapování do dokumenty.';

-- RLS: pouze service_role (cron), žádný veřejný/portal přístup
ALTER TABLE ds_zpravy ENABLE ROW LEVEL SECURITY;
-- Bez policy pro authenticated/anon = ve výchozím stavu nikdo kromě service_role nemá přístup.