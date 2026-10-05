-- =============================================================================
-- Migrace 149 — Rozvrh/třídnice: spojené bloky více tříd (šablona i týden)
-- Datum: 2026-10-05 (idempotentní — opakované spuštění je bezpečné)
-- Prerekvizita: 061 (rozvrh_blok_skupiny M:N, rozvrh_audit), 063 (zámek PPČ),
--               106 (generate_rozvrh, pregenerovat_rozvrh_prepis),
--               141 (can_write_tridnice), 148 (potvrdit_blok se 4 argumenty)
-- PRD: PRD-tridnice-spojene-bloky-obsazeni-dochazka-psd-2026-10-04 (§ 2)
--
-- Kontext (provoz, 2026-10-05): některé bloky absolvují třídy spolu (pravidelně).
-- Model to umí od 061 (K5: jeden blok, víc tříd přes rozvrh_blok_skupiny),
-- chybělo vše ostatní. Princip: ZÁPIS SE NEKOPÍRUJE — jeden blok, víc tříd;
-- obsah, obsazení i příznaky jsou společné, SVP vazby zůstávají per třída
-- (denní kontejner tridni_kniha_zaznamy každé třídy).
--
-- Rozhodnutí:
--   - VLASTNÍK bloku = třída, ze které blok vznikl (šablona: rozvrh_blok_sablona.
--     group_id; ad hoc: třída založení). Ostatní třídy jsou PŘIPOJENÉ.
--   - Rozpojení = odebrání připojené třídy; zápis zůstává vlastníkovi.
--     Vlastníka odebrat nelze.
--   - Spojovat smí kdokoli s právem zápisu do třídnice (can_write_tridnice()),
--     i v šabloně — jen přes RPC níže (RLS šablony zůstává director-only).
--   - Má-li připojovaná třída ve stejném čase vlastní blok, UI se ZEPTÁ;
--     RPC dostane seznam bloků/šablon ke sloučení (nikdy neslučuje samo).
--   - Spojit lze libovolný počet tříd.
--
-- Obsah:
--   A. rozvrh_blok.vlastnik_group_id (+ backfill)
--   B. rozvrh_blok_sablona_pripojene (šablona: připojené třídy)
--   C. Audit M:N tabulek do rozvrh_changes
--   D. zajistit_kontejnery_bloku() — denní záznam třídnice pro KAŽDOU třídu bloku
--   E. potvrdit_blok() — volá D (dřív jen první třída, LIMIT 1)
--   F. spojit_blok() / rozpojit_blok()          — konkrétní týden / třídnice
--   G. spojit_sablonu() / rozpojit_sablonu()    — stálá šablona (+ promítnutí
--      do už vygenerovaných budoucích nepotvrzených bloků)
--   H. generate_rozvrh() — i šablony, ke kterým je třída připojená
--   I. pregenerovat_rozvrh_prepis() — umí i sdílené bloky vlastní šablony
--
-- Zámek PPČ (063): bloky v uzamčeném měsíci se nemění — RPC je odmítnou
-- (konkrétní blok) nebo přeskočí (promítnutí šablony). Do už ZAPSANÉHO bloku
-- se nic nepřelévá — změnilo by to PPČ potvrzeného zápisu.
--
-- POŘADÍ NASAZENÍ: 148 → 149 → kód. Spustit RUČNĚ v Supabase
-- (viz [[migracni-workflow]]); po spuštění `npm run db:types`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. Vlastník bloku
-- -----------------------------------------------------------------------------
ALTER TABLE rozvrh_blok
  ADD COLUMN IF NOT EXISTS vlastnik_group_id UUID REFERENCES groups(id) ON DELETE RESTRICT;

COMMENT ON COLUMN rozvrh_blok.vlastnik_group_id IS
  'Třída, které blok patří (ze které vznikl). Ostatní třídy v rozvrh_blok_skupiny '
  'jsou připojené (spojený blok). Rozpojení odebírá jen připojené. NULL = starý '
  'záznam bez vlastníka → bere se první třída (rozvrh_blok_vlastnik()). Migrace 149.';

-- Backfill: ze šablony, jinak první třída bloku. Zámek PPČ (063) by v uzamčených
-- měsících UPDATE odmítl a audit by zapsal řádek za každý blok — vlastník je jen
-- doplnění metadat, proto se oba triggery na dobu backfillu vypnou.
ALTER TABLE rozvrh_blok DISABLE TRIGGER trg_lock_rozvrh_blok;
ALTER TABLE rozvrh_blok DISABLE TRIGGER trg_audit_rozvrh_blok;
UPDATE rozvrh_blok b
   SET vlastnik_group_id = COALESCE(
         (SELECT s.group_id FROM rozvrh_blok_sablona s
           WHERE s.id = b.sablona_id
             AND EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k
                          WHERE k.blok_id = b.id AND k.group_id = s.group_id)),
         (SELECT k.group_id FROM rozvrh_blok_skupiny k
           WHERE k.blok_id = b.id ORDER BY k.group_id LIMIT 1))
 WHERE b.vlastnik_group_id IS NULL;
ALTER TABLE rozvrh_blok ENABLE TRIGGER trg_lock_rozvrh_blok;
ALTER TABLE rozvrh_blok ENABLE TRIGGER trg_audit_rozvrh_blok;

CREATE OR REPLACE FUNCTION rozvrh_blok_vlastnik(p_blok_id UUID)
RETURNS UUID
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT vlastnik_group_id FROM rozvrh_blok WHERE id = p_blok_id),
    (SELECT group_id FROM rozvrh_blok_skupiny WHERE blok_id = p_blok_id ORDER BY group_id LIMIT 1));
$$;

-- -----------------------------------------------------------------------------
-- B. Šablona: připojené třídy (vlastník = rozvrh_blok_sablona.group_id)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rozvrh_blok_sablona_pripojene (
  blok_sablona_id UUID NOT NULL REFERENCES rozvrh_blok_sablona(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  created_by      UUID REFERENCES staff(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blok_sablona_id, group_id)
);
CREATE INDEX IF NOT EXISTS rozvrh_blok_sablona_pripojene_group_idx
  ON rozvrh_blok_sablona_pripojene (group_id);

COMMENT ON TABLE rozvrh_blok_sablona_pripojene IS
  'Třídy připojené ke stálému bloku šablony jiné třídy (spojená výuka). '
  'Generátor z bloku vytvoří JEDEN rozvrh_blok pro vlastníka i všechny připojené. '
  'Zápis jen přes RPC spojit_sablonu / rozpojit_sablonu (migrace 149).';

ALTER TABLE rozvrh_blok_sablona_pripojene ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rbsp_read ON rozvrh_blok_sablona_pripojene;
CREATE POLICY rbsp_read ON rozvrh_blok_sablona_pripojene
  FOR SELECT USING (current_staff_id() IS NOT NULL);
DROP POLICY IF EXISTS rbsp_dir ON rozvrh_blok_sablona_pripojene;
CREATE POLICY rbsp_dir ON rozvrh_blok_sablona_pripojene
  FOR ALL USING (is_director()) WITH CHECK (is_director());

-- -----------------------------------------------------------------------------
-- C. Audit M:N (rozvrh_audit z 061 počítá s NEW.id — M:N tabulky id nemají)
-- -----------------------------------------------------------------------------
ALTER TABLE rozvrh_changes DROP CONSTRAINT IF EXISTS rozvrh_changes_entita_check;
ALTER TABLE rozvrh_changes ADD CONSTRAINT rozvrh_changes_entita_check
  CHECK (entita IN ('rozvrh_blok', 'rozvrh_obsazeni',
                    'rozvrh_blok_skupiny', 'rozvrh_blok_sablona_pripojene'));

CREATE OR REPLACE FUNCTION rozvrh_audit_mn() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_row   JSONB;
BEGIN
  BEGIN v_actor := current_staff_id(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  v_row := to_jsonb(COALESCE(NEW, OLD));
  INSERT INTO rozvrh_changes (entita, entita_id, akce, stav_pred, stav_po, changed_by)
  VALUES (
    TG_TABLE_NAME,
    CASE TG_TABLE_NAME WHEN 'rozvrh_blok_skupiny' THEN (v_row->>'blok_id')::uuid
                       ELSE (v_row->>'blok_sablona_id')::uuid END,
    lower(TG_OP),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    v_actor);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_rozvrh_blok_skupiny ON rozvrh_blok_skupiny;
CREATE TRIGGER trg_audit_rozvrh_blok_skupiny
  AFTER INSERT OR DELETE ON rozvrh_blok_skupiny
  FOR EACH ROW EXECUTE FUNCTION rozvrh_audit_mn();
DROP TRIGGER IF EXISTS trg_audit_rozvrh_blok_sablona_pripojene ON rozvrh_blok_sablona_pripojene;
CREATE TRIGGER trg_audit_rozvrh_blok_sablona_pripojene
  AFTER INSERT OR DELETE ON rozvrh_blok_sablona_pripojene
  FOR EACH ROW EXECUTE FUNCTION rozvrh_audit_mn();

-- -----------------------------------------------------------------------------
-- D. Denní kontejner třídnice pro každou třídu bloku (interní, bez GRANT)
--    Vrací kontejner vlastníka (→ rozvrh_blok.tridni_zaznam_id).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION zajistit_kontejnery_bloku(p_blok_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blok     rozvrh_blok%ROWTYPE;
  v_vlastnik UUID;
  v_den      CHAR(2);
  v_typ      TEXT;
  v_group    UUID;
  v_zaznam   UUID;
  v_ret      UUID;
BEGIN
  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id;
  v_vlastnik := rozvrh_blok_vlastnik(p_blok_id);

  v_den := CASE EXTRACT(ISODOW FROM v_blok.datum)::int
             WHEN 1 THEN 'po' WHEN 2 THEN 'út' WHEN 3 THEN 'st'
             WHEN 4 THEN 'čt' WHEN 5 THEN 'pá' END;
  IF v_den IS NULL THEN
    RAISE EXCEPTION 'Blok je mimo pracovní dny (Po–Pá).';
  END IF;
  v_typ := CASE
             WHEN v_blok.typ_bloku IN ('vyuka','expedice','projekt','sportovni_kurz','kulturni_akce')
               THEN v_blok.typ_bloku
             ELSE 'vyuka'
           END;

  FOR v_group IN
    SELECT group_id FROM rozvrh_blok_skupiny WHERE blok_id = p_blok_id ORDER BY group_id
  LOOP
    SELECT id INTO v_zaznam FROM tridni_kniha_zaznamy
      WHERE datum = v_blok.datum AND group_id = v_group
      ORDER BY created_at LIMIT 1;
    IF v_zaznam IS NULL THEN
      INSERT INTO tridni_kniha_zaznamy
        (datum, den_v_tydnu, cas_od, cas_do, nazev, typ_zaznamu, school_year, group_id)
      VALUES
        (v_blok.datum, v_den, v_blok.cas_od, v_blok.cas_do, v_blok.nazev, v_typ, v_blok.school_year, v_group)
      RETURNING id INTO v_zaznam;
    END IF;
    -- Vrací se kontejner vlastníka; bez vlastníka (starý blok) první třídy.
    IF v_group = v_vlastnik THEN
      v_ret := v_zaznam;
    ELSIF v_ret IS NULL AND v_vlastnik IS NULL THEN
      v_ret := v_zaznam;
    END IF;
  END LOOP;

  RETURN v_ret;
END;
$$;

REVOKE ALL ON FUNCTION zajistit_kontejnery_bloku(UUID) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. potvrdit_blok — tělo ze 148, kontejnery pro všechny třídy (D)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION potvrdit_blok(
  p_blok_id     UUID,
  p_obsah       TEXT   DEFAULT NULL,
  p_absent_ids  UUID[] DEFAULT '{}',
  p_added_ids   UUID[] DEFAULT '{}'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID;
  v_blok   rozvrh_blok%ROWTYPE;
  v_zaznam UUID;
  v_added  UUID[];
  v_bad    TEXT;
BEGIN
  v_actor := current_staff_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;

  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok neexistuje.';
  END IF;
  IF v_blok.stav = 'zruseno' THEN
    RAISE EXCEPTION 'Zrušený blok nelze potvrdit.';
  END IF;

  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění zapisovat do třídnice.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT a), '{}') INTO v_added
    FROM unnest(COALESCE(p_added_ids, '{}')) AS a
   WHERE NOT EXISTS (
     SELECT 1 FROM rozvrh_obsazeni o
      WHERE o.blok_id = p_blok_id AND o.staff_id = a AND o.zdroj = 'rozvrh'
   );

  SELECT string_agg(COALESCE(z.first_name || ' ' || z.last_name, a::text), ', ') INTO v_bad
    FROM unnest(v_added) AS a
    LEFT JOIN staff z ON z.id = a
   WHERE NOT EXISTS (
     SELECT 1 FROM staff s
      WHERE s.id = a
        AND s.typ_zamestnance = 'pedagogicky'
        AND (s.employment_end IS NULL OR s.employment_end >= v_blok.datum)
   );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Na blok lze přidat jen pedagoga v pracovním poměru k datu bloku (%).', v_bad;
  END IF;

  -- Denní kontejner pro KAŽDOU třídu bloku (spojené bloky); vrací kontejner vlastníka.
  v_zaznam := zajistit_kontejnery_bloku(p_blok_id);

  UPDATE rozvrh_obsazeni
     SET zapocitat_ppc = NOT (staff_id = ANY(p_absent_ids))
   WHERE blok_id = p_blok_id
     AND zdroj = 'rozvrh'
     AND zapocitat_ppc IS DISTINCT FROM NOT (staff_id = ANY(p_absent_ids));

  DELETE FROM rozvrh_obsazeni
   WHERE blok_id = p_blok_id
     AND zdroj = 'tridnice'
     AND NOT (staff_id = ANY(v_added));

  INSERT INTO rozvrh_obsazeni (blok_id, staff_id, pozice_na_bloku, zapocitat_ppc, zdroj)
  SELECT p_blok_id, a, 'asistuje', true, 'tridnice'
    FROM unnest(v_added) AS a
  ON CONFLICT (blok_id, staff_id) DO NOTHING;

  UPDATE rozvrh_blok
     SET obsah            = COALESCE(NULLIF(p_obsah, ''), obsah),
         potvrzeno_at     = now(),
         potvrzeno_by     = v_actor,
         stav             = 'odehrano',
         tridni_zaznam_id = v_zaznam
   WHERE id = p_blok_id;

  RETURN v_zaznam;
END;
$$;

REVOKE EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION potvrdit_blok(UUID, TEXT, UUID[], UUID[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- F1. spojit_blok — připojí třídy ke konkrétnímu bloku; volitelně sloučí
--     jejich souběžné vlastní bloky (obsazení/příznaky/obsah přejdou, blok zanikne).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rozvrh_mesic_zamcen(p_datum DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka WHERE obdobi = to_char(p_datum, 'YYYY-MM'));
$$;

-- Interní: přelije blok p_z do p_do (obsazení, příznaky, obsah) a p_z smaže.
CREATE OR REPLACE FUNCTION rozvrh_slouc_blok(p_do UUID, p_z UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obsah TEXT;
BEGIN
  INSERT INTO rozvrh_obsazeni
    (blok_id, staff_id, pozice_na_bloku, je_suplovani, supluje_za_staff_id, zapocitat_ppc, zdroj)
  SELECT p_do, o.staff_id, o.pozice_na_bloku, o.je_suplovani, o.supluje_za_staff_id, o.zapocitat_ppc, o.zdroj
    FROM rozvrh_obsazeni o WHERE o.blok_id = p_z
  ON CONFLICT (blok_id, staff_id) DO NOTHING;

  UPDATE rozvrh_blok_priznak SET blok_id = p_do
   WHERE blok_id = p_z
     AND typ_kod NOT IN (SELECT typ_kod FROM rozvrh_blok_priznak WHERE blok_id = p_do);

  SELECT NULLIF(trim(obsah), '') INTO v_obsah FROM rozvrh_blok WHERE id = p_z;
  IF v_obsah IS NOT NULL THEN
    UPDATE rozvrh_blok
       SET obsah = CASE WHEN NULLIF(trim(obsah), '') IS NULL THEN v_obsah
                        ELSE obsah || E'\n' || v_obsah END
     WHERE id = p_do;
  END IF;

  DELETE FROM rozvrh_blok WHERE id = p_z;   -- CASCADE: skupiny, obsazení, zbylé příznaky
END;
$$;

REVOKE ALL ON FUNCTION rozvrh_slouc_blok(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION spojit_blok(
  p_blok_id     UUID,
  p_group_ids   UUID[],
  p_slouceni_ids UUID[] DEFAULT '{}'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blok   rozvrh_blok%ROWTYPE;
  v_m      rozvrh_blok%ROWTYPE;
  v_groups UUID[];
  v_bad    TEXT;
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;
  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění spojovat bloky.';
  END IF;

  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok neexistuje.';
  END IF;
  IF v_blok.stav = 'zruseno' THEN
    RAISE EXCEPTION 'Zrušený blok nelze spojit.';
  END IF;
  IF rozvrh_mesic_zamcen(v_blok.datum) THEN
    RAISE EXCEPTION 'Měsíc % je ve výkazu PPČ uzamčen — spojení nelze změnit.', to_char(v_blok.datum, 'YYYY-MM');
  END IF;

  -- Nové třídy (bez těch, které už na bloku jsou).
  SELECT COALESCE(array_agg(DISTINCT g), '{}') INTO v_groups
    FROM unnest(COALESCE(p_group_ids, '{}')) AS g
   WHERE NOT EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k WHERE k.blok_id = p_blok_id AND k.group_id = g);

  SELECT string_agg(g::text, ', ') INTO v_bad
    FROM unnest(v_groups) AS g
   WHERE NOT EXISTS (SELECT 1 FROM groups x WHERE x.id = g AND x.school_year = v_blok.school_year);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Třídu nelze připojit — neexistuje ve školním roce % (%).', v_blok.school_year, v_bad;
  END IF;

  -- Sloučení souběžných bloků připojovaných tříd (jen na výslovný pokyn z UI).
  FOR v_m IN
    SELECT b.* FROM rozvrh_blok b
     WHERE b.id = ANY(COALESCE(p_slouceni_ids, '{}')) AND b.id <> p_blok_id
  LOOP
    IF v_m.datum <> v_blok.datum OR v_m.cas_od >= v_blok.cas_do OR v_m.cas_do <= v_blok.cas_od THEN
      RAISE EXCEPTION 'Blok „%" neprobíhá ve stejnou dobu — nelze sloučit.', v_m.nazev;
    END IF;
    IF v_m.potvrzeno_at IS NOT NULL OR v_m.stav = 'odehrano' THEN
      RAISE EXCEPTION 'Blok „%" je už zapsaný — nejdřív zrušte jeho potvrzení.', v_m.nazev;
    END IF;
    IF EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k
                WHERE k.blok_id = v_m.id
                  AND NOT (k.group_id = ANY(v_groups))
                  AND NOT EXISTS (SELECT 1 FROM rozvrh_blok_skupiny k2
                                   WHERE k2.blok_id = p_blok_id AND k2.group_id = k.group_id)) THEN
      RAISE EXCEPTION 'Blok „%" patří i jiné třídě, než se připojuje — nelze sloučit.', v_m.nazev;
    END IF;
    PERFORM rozvrh_slouc_blok(p_blok_id, v_m.id);
  END LOOP;

  IF v_blok.vlastnik_group_id IS NULL THEN
    UPDATE rozvrh_blok SET vlastnik_group_id = rozvrh_blok_vlastnik(p_blok_id) WHERE id = p_blok_id;
  END IF;

  INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
  SELECT p_blok_id, g FROM unnest(v_groups) AS g
  ON CONFLICT DO NOTHING;

  -- Zapsaný blok → nové třídy ho mají v třídnici hned (denní kontejner).
  IF v_blok.potvrzeno_at IS NOT NULL THEN
    PERFORM zajistit_kontejnery_bloku(p_blok_id);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION spojit_blok(UUID, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION spojit_blok(UUID, UUID[], UUID[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- F2. rozpojit_blok — odebere připojenou třídu; vlastníka odebrat nelze.
--     Odebraná třída o zápis bloku přichází (text dne se odvozuje z M:N).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rozpojit_blok(
  p_blok_id  UUID,
  p_group_id UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blok rozvrh_blok%ROWTYPE;
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;
  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění rozpojovat bloky.';
  END IF;

  SELECT * INTO v_blok FROM rozvrh_blok WHERE id = p_blok_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok neexistuje.';
  END IF;
  IF rozvrh_mesic_zamcen(v_blok.datum) THEN
    RAISE EXCEPTION 'Měsíc % je ve výkazu PPČ uzamčen — spojení nelze změnit.', to_char(v_blok.datum, 'YYYY-MM');
  END IF;
  IF p_group_id = rozvrh_blok_vlastnik(p_blok_id) THEN
    RAISE EXCEPTION 'Třídu, které blok patří, nelze odpojit — blok lze jen zrušit.';
  END IF;

  IF v_blok.vlastnik_group_id IS NULL THEN
    UPDATE rozvrh_blok SET vlastnik_group_id = rozvrh_blok_vlastnik(p_blok_id) WHERE id = p_blok_id;
  END IF;

  DELETE FROM rozvrh_blok_skupiny WHERE blok_id = p_blok_id AND group_id = p_group_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION rozpojit_blok(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rozpojit_blok(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- G1. spojit_sablonu — připojí třídy ke stálému bloku šablony.
--     p_slouceni_sablona_ids: vlastní souběžné bloky šablon připojovaných tříd,
--     které se mají sloučit (obsazení přejde, jejich platnost skončí včerejškem;
--     ještě nezačaté se smažou).
--     Promítne se i do už vygenerovaných BUDOUCÍCH (od dneška) nepotvrzených
--     bloků mimo uzamčené měsíce. Vrací počty.
-- -----------------------------------------------------------------------------
-- Interní: vytvoří (nebo vrátí existující) blok šablony na daný den se všemi
-- jejími třídami a plánovaným obsazením. NULL = šablona ten den neplatí.
CREATE OR REPLACE FUNCTION rozvrh_materializuj_sablonu(p_sablona_id UUID, p_datum DATE)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sab rozvrh_blok_sablona%ROWTYPE;
  v_id  UUID;
BEGIN
  SELECT id INTO v_id FROM rozvrh_blok WHERE sablona_id = p_sablona_id AND datum = p_datum;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT * INTO v_sab FROM rozvrh_blok_sablona
   WHERE id = p_sablona_id
     AND den_v_tydnu = EXTRACT(ISODOW FROM p_datum)
     AND valid_from <= p_datum AND (valid_to IS NULL OR valid_to >= p_datum);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO rozvrh_blok (datum, school_year, cas_od, cas_do, nazev, typ_bloku, sablona_id, vlastnik_group_id)
    VALUES (p_datum, v_sab.school_year, v_sab.cas_od, v_sab.cas_do, v_sab.nazev, v_sab.typ_bloku, v_sab.id, v_sab.group_id)
    RETURNING id INTO v_id;
  INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
    SELECT v_id, v_sab.group_id
    UNION
    SELECT v_id, p.group_id FROM rozvrh_blok_sablona_pripojene p WHERE p.blok_sablona_id = v_sab.id
    ON CONFLICT DO NOTHING;
  INSERT INTO rozvrh_obsazeni (blok_id, staff_id, pozice_na_bloku)
    SELECT v_id, so.staff_id, so.pozice_na_bloku
      FROM rozvrh_sablona_obsazeni so WHERE so.blok_sablona_id = v_sab.id
    ON CONFLICT (blok_id, staff_id) DO NOTHING;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION rozvrh_materializuj_sablonu(UUID, DATE) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION spojit_sablonu(
  p_sablona_id           UUID,
  p_group_ids            UUID[],
  p_slouceni_sablona_ids UUID[] DEFAULT '{}'
) RETURNS TABLE (pripojeno_bloku INT, slouceno_bloku INT, ponechano_bloku INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor  UUID;
  v_sab    rozvrh_blok_sablona%ROWTYPE;
  v_t      rozvrh_blok_sablona%ROWTYPE;
  v_groups UUID[];
  v_bad    TEXT;
  v_b      rozvrh_blok%ROWTYPE;
  v_cil    UUID;
  v_prip   INT := 0;
  v_slouc  INT := 0;
  v_pon    INT := 0;
BEGIN
  v_actor := current_staff_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;
  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění spojovat bloky.';
  END IF;

  SELECT * INTO v_sab FROM rozvrh_blok_sablona WHERE id = p_sablona_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok šablony neexistuje.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT g), '{}') INTO v_groups
    FROM unnest(COALESCE(p_group_ids, '{}')) AS g
   WHERE g <> v_sab.group_id
     AND NOT EXISTS (SELECT 1 FROM rozvrh_blok_sablona_pripojene p
                      WHERE p.blok_sablona_id = p_sablona_id AND p.group_id = g);

  SELECT string_agg(g::text, ', ') INTO v_bad
    FROM unnest(v_groups) AS g
   WHERE NOT EXISTS (SELECT 1 FROM groups x WHERE x.id = g AND x.school_year = v_sab.school_year);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Třídu nelze připojit — neexistuje ve školním roce % (%).', v_sab.school_year, v_bad;
  END IF;

  INSERT INTO rozvrh_blok_sablona_pripojene (blok_sablona_id, group_id, created_by)
  SELECT p_sablona_id, g, v_actor FROM unnest(v_groups) AS g
  ON CONFLICT DO NOTHING;

  -- Promítnutí do vygenerovaných budoucích bloků této šablony.
  FOR v_b IN
    SELECT * FROM rozvrh_blok
     WHERE sablona_id = p_sablona_id AND datum >= CURRENT_DATE
       AND stav <> 'zruseno' AND potvrzeno_at IS NULL
     ORDER BY datum
  LOOP
    IF rozvrh_mesic_zamcen(v_b.datum) THEN
      v_pon := v_pon + 1;
      CONTINUE;
    END IF;
    INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
    SELECT v_b.id, g FROM unnest(v_groups) AS g
    ON CONFLICT DO NOTHING;
    v_prip := v_prip + 1;
  END LOOP;

  -- Sloučení souběžných bloků šablon připojovaných tříd.
  FOR v_t IN
    SELECT * FROM rozvrh_blok_sablona
     WHERE id = ANY(COALESCE(p_slouceni_sablona_ids, '{}')) AND id <> p_sablona_id
     FOR UPDATE
  LOOP
    IF NOT (v_t.group_id = ANY(v_groups)
            OR EXISTS (SELECT 1 FROM rozvrh_blok_sablona_pripojene p
                        WHERE p.blok_sablona_id = p_sablona_id AND p.group_id = v_t.group_id)) THEN
      RAISE EXCEPTION 'Blok šablony „%" nepatří připojované třídě — nelze sloučit.', v_t.nazev;
    END IF;
    IF v_t.den_v_tydnu <> v_sab.den_v_tydnu OR v_t.cas_od >= v_sab.cas_do OR v_t.cas_do <= v_sab.cas_od THEN
      RAISE EXCEPTION 'Blok šablony „%" neprobíhá ve stejnou dobu — nelze sloučit.', v_t.nazev;
    END IF;

    -- Obsazení šablony → do společného bloku.
    INSERT INTO rozvrh_sablona_obsazeni (blok_sablona_id, staff_id, pozice_na_bloku)
    SELECT p_sablona_id, so.staff_id, so.pozice_na_bloku
      FROM rozvrh_sablona_obsazeni so WHERE so.blok_sablona_id = v_t.id
    ON CONFLICT (blok_sablona_id, staff_id) DO NOTHING;

    -- Jeho vygenerované budoucí nepotvrzené bloky → sloučit do společného bloku
    -- téhož dne (chybí-li, vytvoří se). Zapsaný společný blok se nemění (PPČ) —
    -- pak vlastní blok třídy zůstává; stejně tak, když šablona ten den neplatí.
    FOR v_b IN
      SELECT * FROM rozvrh_blok
       WHERE sablona_id = v_t.id AND datum >= CURRENT_DATE
       ORDER BY datum
    LOOP
      IF v_b.potvrzeno_at IS NOT NULL OR v_b.stav = 'odehrano' OR rozvrh_mesic_zamcen(v_b.datum) THEN
        v_pon := v_pon + 1;
        CONTINUE;
      END IF;
      v_cil := rozvrh_materializuj_sablonu(p_sablona_id, v_b.datum);
      IF v_cil IS NULL
         OR EXISTS (SELECT 1 FROM rozvrh_blok c
                     WHERE c.id = v_cil AND (c.potvrzeno_at IS NOT NULL OR c.stav <> 'planovano')) THEN
        v_pon := v_pon + 1;
        CONTINUE;
      END IF;
      INSERT INTO rozvrh_blok_skupiny (blok_id, group_id) VALUES (v_cil, v_t.group_id)
        ON CONFLICT DO NOTHING;
      PERFORM rozvrh_slouc_blok(v_cil, v_b.id);
      v_slouc := v_slouc + 1;
    END LOOP;

    -- Konec platnosti vlastního bloku šablony (nezačatý → smazat).
    IF v_t.valid_from >= CURRENT_DATE THEN
      DELETE FROM rozvrh_blok_sablona WHERE id = v_t.id;
    ELSIF v_t.valid_to IS NULL OR v_t.valid_to >= CURRENT_DATE THEN
      UPDATE rozvrh_blok_sablona SET valid_to = CURRENT_DATE - 1 WHERE id = v_t.id;
    END IF;
  END LOOP;

  pripojeno_bloku := v_prip;
  slouceno_bloku  := v_slouc;
  ponechano_bloku := v_pon;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION spojit_sablonu(UUID, UUID[], UUID[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION spojit_sablonu(UUID, UUID[], UUID[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- G2. rozpojit_sablonu — odebere připojenou třídu ze šablony i z budoucích
--     nepotvrzených bloků (mimo uzamčené měsíce). Zapsané bloky zůstávají.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rozpojit_sablonu(
  p_sablona_id UUID,
  p_group_id   UUID
) RETURNS TABLE (odpojeno_bloku INT, ponechano_bloku INT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sab  rozvrh_blok_sablona%ROWTYPE;
  v_b    rozvrh_blok%ROWTYPE;
  v_odp  INT := 0;
  v_pon  INT := 0;
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'Nepřihlášený uživatel.';
  END IF;
  IF NOT can_write_tridnice() THEN
    RAISE EXCEPTION 'Nemáš oprávnění rozpojovat bloky.';
  END IF;

  SELECT * INTO v_sab FROM rozvrh_blok_sablona WHERE id = p_sablona_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blok šablony neexistuje.';
  END IF;
  IF p_group_id = v_sab.group_id THEN
    RAISE EXCEPTION 'Třídu, které blok šablony patří, nelze odpojit — blok lze jen smazat.';
  END IF;

  DELETE FROM rozvrh_blok_sablona_pripojene
   WHERE blok_sablona_id = p_sablona_id AND group_id = p_group_id;

  FOR v_b IN
    SELECT b.* FROM rozvrh_blok b
      JOIN rozvrh_blok_skupiny k ON k.blok_id = b.id AND k.group_id = p_group_id
     WHERE b.sablona_id = p_sablona_id AND b.datum >= CURRENT_DATE
  LOOP
    IF v_b.potvrzeno_at IS NOT NULL OR v_b.stav = 'odehrano' OR rozvrh_mesic_zamcen(v_b.datum) THEN
      v_pon := v_pon + 1;
      CONTINUE;
    END IF;
    DELETE FROM rozvrh_blok_skupiny WHERE blok_id = v_b.id AND group_id = p_group_id;
    v_odp := v_odp + 1;
  END LOOP;

  odpojeno_bloku  := v_odp;
  ponechano_bloku := v_pon;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION rozpojit_sablonu(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION rozpojit_sablonu(UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- H. generate_rozvrh — i bloky šablon, ke kterým je třída připojená; nový blok
--    dostane vlastníka a všechny třídy najednou. Existující bloky nemění
--    (ruční rozpojení konkrétního dne se tak nepřepíše).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_rozvrh(
  p_group_id  UUID,
  p_date_from DATE,
  p_date_to   DATE
) RETURNS TABLE (inserted INT, skipped INT)
LANGUAGE plpgsql AS $$
DECLARE
  v_cur      DATE;
  v_dow      SMALLINT;
  v_sab      rozvrh_blok_sablona%ROWTYPE;
  v_blok_id  UUID;
  v_ins      INT := 0;
  v_skip     INT := 0;
BEGIN
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from (%) musí být <= date_to (%).', p_date_from, p_date_to;
  END IF;

  v_cur := p_date_from;
  WHILE v_cur <= p_date_to LOOP
    v_dow := EXTRACT(ISODOW FROM v_cur);
    IF v_dow <= 5
       AND NOT EXISTS (SELECT 1 FROM school_holidays WHERE datum = v_cur)
       AND NOT EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka WHERE obdobi = to_char(v_cur, 'YYYY-MM'))
    THEN
      FOR v_sab IN
        SELECT s.* FROM rozvrh_blok_sablona s
         WHERE (s.group_id = p_group_id
                OR EXISTS (SELECT 1 FROM rozvrh_blok_sablona_pripojene p
                            WHERE p.blok_sablona_id = s.id AND p.group_id = p_group_id))
           AND s.den_v_tydnu = v_dow
           AND s.valid_from <= v_cur
           AND (s.valid_to IS NULL OR s.valid_to >= v_cur)
      LOOP
        v_blok_id := NULL;
        SELECT id INTO v_blok_id FROM rozvrh_blok
          WHERE sablona_id = v_sab.id AND datum = v_cur;
        IF v_blok_id IS NULL THEN
          INSERT INTO rozvrh_blok (datum, school_year, cas_od, cas_do, nazev, typ_bloku, sablona_id, vlastnik_group_id)
            VALUES (v_cur, v_sab.school_year, v_sab.cas_od, v_sab.cas_do, v_sab.nazev, v_sab.typ_bloku, v_sab.id, v_sab.group_id)
            RETURNING id INTO v_blok_id;
          INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
            SELECT v_blok_id, v_sab.group_id
            UNION
            SELECT v_blok_id, p.group_id FROM rozvrh_blok_sablona_pripojene p WHERE p.blok_sablona_id = v_sab.id
            ON CONFLICT DO NOTHING;
          INSERT INTO rozvrh_obsazeni (blok_id, staff_id, pozice_na_bloku)
            SELECT v_blok_id, so.staff_id, so.pozice_na_bloku
              FROM rozvrh_sablona_obsazeni so WHERE so.blok_sablona_id = v_sab.id
            ON CONFLICT (blok_id, staff_id) DO NOTHING;
          v_ins := v_ins + 1;
        ELSE
          v_skip := v_skip + 1;
        END IF;
      END LOOP;
    END IF;
    v_cur := v_cur + 1;
  END LOOP;

  inserted := v_ins;
  skipped  := v_skip;
  RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- I. pregenerovat_rozvrh_prepis — sdílený blok smí smazat (a nahodit znovu),
--    pokud je ze šablony, KTEROU TŘÍDA VLASTNÍ, a jeho třídy jsou jen vlastník
--    + připojené v šabloně (nic ručně připojeného navíc). Jinak 'shared' jako dřív.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pregenerovat_rozvrh_prepis(
  p_group_id  UUID,
  p_date_from DATE,
  p_date_to   DATE
) RETURNS TABLE (deleted INT, inserted INT, kept JSONB)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_del  INT   := 0;
  v_ins  INT   := 0;
  v_kept JSONB := '[]'::jsonb;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'Jen ředitel může přepsat rozvrh ze šablony.';
  END IF;
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from (%) musí být <= date_to (%).', p_date_from, p_date_to;
  END IF;

  WITH cand AS (
    SELECT b.id, b.datum, b.cas_od, b.cas_do, b.nazev, b.stav, b.potvrzeno_at,
           EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka u
                     WHERE u.obdobi = to_char(b.datum, 'YYYY-MM'))           AS locked,
           EXISTS (SELECT 1 FROM rozvrh_blok_skupiny s2
                     WHERE s2.blok_id = b.id AND s2.group_id <> p_group_id)  AS shared,
           -- sdílený, ale „náš ze šablony" → smí se přepsat
           (b.sablona_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM rozvrh_blok_sablona sb
                         WHERE sb.id = b.sablona_id AND sb.group_id = p_group_id)
            AND NOT EXISTS (
              SELECT 1 FROM rozvrh_blok_skupiny s3
               WHERE s3.blok_id = b.id
                 AND s3.group_id <> p_group_id
                 AND NOT EXISTS (SELECT 1 FROM rozvrh_blok_sablona_pripojene p
                                  WHERE p.blok_sablona_id = b.sablona_id AND p.group_id = s3.group_id)
            ))                                                                AS shared_own
      FROM rozvrh_blok b
      JOIN rozvrh_blok_skupiny s ON s.blok_id = b.id AND s.group_id = p_group_id
     WHERE b.datum BETWEEN p_date_from AND p_date_to
  ),
  classified AS (
    SELECT c.*,
           CASE
             WHEN c.potvrzeno_at IS NOT NULL OR c.stav = 'odehrano' THEN 'confirmed'
             WHEN c.locked THEN 'locked'
             WHEN c.shared AND NOT c.shared_own THEN 'shared'
             ELSE 'delete'
           END AS bucket
      FROM cand c
  ),
  del AS (
    DELETE FROM rozvrh_blok b
     USING classified c
     WHERE b.id = c.id AND c.bucket = 'delete'
    RETURNING 1
  )
  SELECT
    (SELECT count(*)::int FROM del),
    (SELECT COALESCE(jsonb_agg(
              jsonb_build_object('datum', datum, 'cas_od', cas_od, 'cas_do', cas_do,
                                 'nazev', nazev, 'reason', bucket)
              ORDER BY datum, cas_od), '[]'::jsonb)
       FROM classified WHERE bucket <> 'delete')
  INTO v_del, v_kept;

  SELECT gr.inserted INTO v_ins
    FROM generate_rozvrh(p_group_id, p_date_from, p_date_to) gr;

  deleted  := v_del;
  inserted := v_ins;
  kept     := v_kept;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION pregenerovat_rozvrh_prepis(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pregenerovat_rozvrh_prepis(UUID, DATE, DATE) TO authenticated;

COMMIT;

-- =============================================================================
-- Ověření (samostatně):
--   SELECT count(*) FROM rozvrh_blok WHERE vlastnik_group_id IS NULL;     -- 0 (bloky bez třídy výjimkou)
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('spojit_blok','rozpojit_blok','spojit_sablonu','rozpojit_sablonu',
--      'zajistit_kontejnery_bloku','rozvrh_slouc_blok',
--      'rozvrh_materializuj_sablonu');                                      -- 7 řádků
--   SELECT to_regclass('public.rozvrh_blok_sablona_pripojene');           -- not null
-- =============================================================================
