-- =============================================================================
-- Migrace 170 — Potvrzení o studiu: evidence vydaných + ověření QR kódem
-- Datum: 2026-11-05
--
-- Rodič si v portálu generuje potvrzení o studiu (PR #78). Nově:
--   • každé vydání se zapíše do potvrzeni_o_studiu (snapshot údajů z PDF),
--   • PDF nese ověřovací kód + QR odkaz na veřejnou stránku /overeni/<kod>,
--     která z tohoto záznamu ukáže, co škola skutečně vydala (a zda platí),
--   • PDF nese sken podpisu a razítka z privátního bucketu skola-podpis.
--
-- Zápis i čtení pro ověření dělá server service-role klientem (po ověření
-- rodiče / na veřejné stránce jen podle kódu) → pro authenticated jen SELECT
-- pro ředitele/zástupce (přehled vydaných). Anon nemá přístup vůbec.
--
-- Obsah:
--   A. tabulka potvrzeni_o_studiu + RLS
--   B. privátní Storage bucket skola-podpis (podpis.png / razitko.png)
--
-- Migrační workflow: spustit ručně v Supabase SQL editoru, pak npm run db:types.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Evidence vydaných potvrzení
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS potvrzeni_o_studiu (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kod                text NOT NULL UNIQUE,              -- 12 znaků, bez pomlček
  student_id         uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  vydal_guardian_id  uuid REFERENCES guardians(id) ON DELETE SET NULL,
  vydano_at          timestamptz NOT NULL DEFAULT now(),
  plati_do           date NOT NULL,
  -- snapshot údajů, které PDF uvádí (ověřovací stránka je zobrazí)
  jmeno_zaka         text NOT NULL,
  datum_narozeni     date,
  skolni_rok         text NOT NULL,
  trida              text,
  rocnik             integer,
  ucel               text,
  -- zneplatnění školou (např. vydáno omylem, žák odešel)
  zneplatneno_at     timestamptz,
  zneplatneno_duvod  text,
  CONSTRAINT potvrzeni_kod_format CHECK (kod ~ '^[A-Z2-9]{12}$')
);

CREATE INDEX IF NOT EXISTS potvrzeni_o_studiu_student_idx
  ON potvrzeni_o_studiu (student_id, vydano_at DESC);

COMMENT ON TABLE potvrzeni_o_studiu IS
  'Vydaná potvrzení o studiu z rodičovského portálu; kod = ověření na /overeni/<kod>. Zápis jen service role. Migrace 170.';

ALTER TABLE potvrzeni_o_studiu ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS potvrzeni_o_studiu_select ON potvrzeni_o_studiu;
CREATE POLICY potvrzeni_o_studiu_select ON potvrzeni_o_studiu
  FOR SELECT TO authenticated
  USING (is_director_or_vp());

REVOKE ALL ON potvrzeni_o_studiu FROM anon;

-- -----------------------------------------------------------------------------
-- B. Privátní bucket pro sken podpisu a razítka
--    Bez storage policies → přístup jen service role (server).
-- -----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('skola-podpis', 'skola-podpis', false, 1048576, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Ověření:
-- SELECT count(*) FROM potvrzeni_o_studiu;                       -- 0
-- SELECT id, public FROM storage.buckets WHERE id = 'skola-podpis';  -- false
