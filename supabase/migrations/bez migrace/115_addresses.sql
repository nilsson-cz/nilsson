-- =============================================================================
-- Migrace 115 — Jednotný adresní model (tabulka `addresses`) — M1 SCHÉMA
-- Datum: 2026-09-20 (idempotentní)
-- Prerekvizity: 20260428000001_matrika.sql (students, guardians),
--   20260428000006_rls.sql (is_director_or_vp, can_read_student, can_read_guardian,
--   set_updated_at), RÚIAN lookup tabulky ruian_adresni_mista + ruian_obce
--   (existují v produkci, používá je i enrollment_record_decision — viz migrace 037).
-- PRD: Nilsson_documentation/daily_notes/PRD-adresni-model-2026-09-20.md
--
-- Účel (M1): normalizovaná tabulka pro až 6 adres na case — dítě (trvalé +
--   kontaktní), otec (trvalé + kontaktní), matka (trvalé + kontaktní). Jen
--   SCHÉMA; backfill (M2), čtení/helper (M3), capture ve wizardu (M4), editace
--   v matrice (M5), drop starých sloupců (M6) jsou samostatné migrace/PR.
--
-- Rozhodnutí §9 PRD:
--   Q4  2 nullable FK (student_id / guardian_id) + CHECK „právě jedna" — fyzická
--       integrita + ON DELETE CASCADE (proti polymorfnímu owner_type/owner_id).
--   Q5  kontaktní adresa dítěte se persistuje (typ='kontaktni' na student řádku).
--   Q1  trvalé bydliště ZZ povinné — vynucuje CAPTURE (wizard M4), ne tato tabulka.
--   Q2/Q6  validační POLITIKA (trvalé vždy RÚIAN; kontaktní v ČR RÚIAN, zahraniční
--       volný text) se vynucuje v APLIKACI (wizard M4 + editace M5). DB CHECK je
--       jen STRUKTURÁLNÍ (ruian_kod ⇔ validated_at), aby M2 backfill unesl i legacy
--       nevalidované adresy (starší žáci/zástupci bez RÚIAN) — striktní DB blok by
--       o ně přišel. „Validovaná" adresa = má ruian_kod i validated_at.
--
-- MŠMT: students.obec_bydliste_kod / okres_bydliste_kod zůstávají denormalizovaná
--   cache pro výkaz M3 — drží je trigger z TRVALÉ adresy žáka (RÚIAN → kod_obce /
--   kod_okresu, stejný lookup jako enrollment_record_decision).
--
-- Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]). Idempotentní:
--   DO/IF NOT EXISTS pro enum, CREATE TABLE/INDEX IF NOT EXISTS, DROP/CREATE
--   POLICY, CREATE OR REPLACE funkce.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enum typu adresy
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'address_typ') THEN
    CREATE TYPE address_typ AS ENUM ('trvale', 'kontaktni');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Tabulka addresses
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- právě jedna z FK (viz chk_addr_owner); ON DELETE CASCADE uklidí adresy
  student_id    UUID REFERENCES students(id)  ON DELETE CASCADE,
  guardian_id   UUID REFERENCES guardians(id) ON DELETE CASCADE,

  typ           address_typ NOT NULL,

  -- adresní pole
  ulice         TEXT,           -- může být NULL (obce bez uličního systému)
  cislo         TEXT NOT NULL,  -- číslo popisné / orientační
  obec          TEXT NOT NULL,
  psc           TEXT NOT NULL,
  ruian_kod     TEXT,           -- kód adresního místa (RÚIAN); NULL = nevalidováno
  country       TEXT NOT NULL DEFAULT 'CZ',
  validated_at  TIMESTAMPTZ,    -- kdy validováno přes RÚIAN; párové s ruian_kod

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- právě jedna vlastnící entita (student NEBO guardian)
  CONSTRAINT chk_addr_owner CHECK ((student_id IS NOT NULL) <> (guardian_id IS NOT NULL)),
  -- strukturální: ruian_kod a validated_at jdou vždy spolu (validovaná adresa má
  -- obojí, nevalidovaná/legacy/zahraniční obojí NULL). Politika „trvalé/ČR = RÚIAN"
  -- se vynucuje v aplikaci (M4/M5), ne zde — kvůli backfillu legacy adres.
  CONSTRAINT chk_addr_ruian_pair CHECK ((ruian_kod IS NULL) = (validated_at IS NULL))
);

-- max 1 trvalé + 1 kontaktní na entitu (partial unique kvůli nullable FK)
CREATE UNIQUE INDEX IF NOT EXISTS uq_addr_student
  ON addresses (student_id, typ)  WHERE student_id  IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_addr_guardian
  ON addresses (guardian_id, typ) WHERE guardian_id IS NOT NULL;

COMMENT ON TABLE addresses IS
  'Jednotný adresní model (PRD adresni-model, M1). Až 6 adres na case: dítě/otec/'
  'matka × trvalé/kontaktní. Právě jedna z FK student_id/guardian_id. Validovaná '
  'adresa má ruian_kod + validated_at; validační politiku (trvalé/ČR = RÚIAN) '
  'vynucuje aplikace, DB drží jen strukturu (kvůli backfillu legacy adres).';

-- -----------------------------------------------------------------------------
-- 3. updated_at trigger (reuse set_updated_at, když existuje)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS addresses_set_updated_at ON addresses;
    CREATE TRIGGER addresses_set_updated_at
      BEFORE UPDATE ON addresses
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4. MŠMT cache: students.obec_bydliste_kod / okres_bydliste_kod z TRVALÉ adresy
--    žáka (RÚIAN → kod_obce/kod_okresu). SECURITY DEFINER + row_security=off, aby
--    trigger směl psát do students pod FORCE RLS (vzor migrace 047).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION addresses_sync_msmt_kody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $fn$
DECLARE
  v_student UUID;
  v_typ     address_typ;
  v_ruian   TEXT;
  v_obec    TEXT;
  v_okres   TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_student := OLD.student_id; v_typ := OLD.typ; v_ruian := NULL;
  ELSE
    v_student := NEW.student_id; v_typ := NEW.typ; v_ruian := NEW.ruian_kod;
  END IF;

  -- MŠMT cache drží jen TRVALÉ bydliště žáka
  IF v_student IS NOT NULL AND v_typ = 'trvale' THEN
    IF v_ruian IS NOT NULL THEN
      -- ra.ruian_kod je bigint, addresses.ruian_kod je text → porovnání v textu
      -- (shodně s enrollment_record_decision po opravě v migraci 113).
      SELECT ra.kod_obce::text, ro.kod_okresu::text
        INTO v_obec, v_okres
        FROM ruian_adresni_mista ra
        JOIN ruian_obce ro ON ro.kod_obce = ra.kod_obce
       WHERE ra.ruian_kod::text = v_ruian;
    END IF;
    -- při DELETE / nevalidované adrese se kódy vynulují (v_obec/v_okres = NULL)
    UPDATE students
       SET obec_bydliste_kod = v_obec,
           okres_bydliste_kod = v_okres
     WHERE id = v_student;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$fn$;

COMMENT ON FUNCTION addresses_sync_msmt_kody() IS
  'Drží students.obec_bydliste_kod/okres_bydliste_kod (MŠMT výkaz M3) v souladu '
  's trvalou adresou žáka v addresses. RÚIAN lookup jako enrollment_record_decision.';

DROP TRIGGER IF EXISTS addresses_msmt_sync ON addresses;
CREATE TRIGGER addresses_msmt_sync
  AFTER INSERT OR UPDATE OR DELETE ON addresses
  FOR EACH ROW EXECUTE FUNCTION addresses_sync_msmt_kody();

-- -----------------------------------------------------------------------------
-- 5. RLS — čtení dle přístupu k entitě, zápis ředitel/VP (matriční agenda).
--    Rozšíření na rodičovský portál (rodič edituje své/dítěte adresy) = M5.
-- -----------------------------------------------------------------------------
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE addresses FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS addresses_select ON addresses;
CREATE POLICY addresses_select ON addresses
  FOR SELECT USING (
    (student_id  IS NOT NULL AND can_read_student(student_id))
    OR (guardian_id IS NOT NULL AND can_read_guardian(guardian_id))
  );

DROP POLICY IF EXISTS addresses_write ON addresses;
CREATE POLICY addresses_write ON addresses
  FOR ALL
  USING (is_director_or_vp())
  WITH CHECK (is_director_or_vp());

COMMIT;

-- =============================================================================
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT to_regclass('public.addresses');                      -- addresses
--   SELECT typname FROM pg_type WHERE typname = 'address_typ';    -- address_typ
--   SELECT tablename, policyname FROM pg_policies WHERE tablename = 'addresses';
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'addresses'::regclass;
-- Po migraci spustit `npm run db:types` (M2+ kód pak čte typované addresses;
--   do té doby žádný kód addresses nepoužívá — M1 je jen schéma).
-- =============================================================================
