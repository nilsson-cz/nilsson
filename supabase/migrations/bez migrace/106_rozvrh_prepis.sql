-- =============================================================================
-- Migrace 106 — Rozvrh: destruktivní „Přegenerovat od tohoto týdne" (PŘEPIS)
-- Datum: 2026-09-07
-- Prerekvizita: 061_rozvrh_core.sql (rozvrh_blok, generate_rozvrh, audit trigger),
--               062_rozvrh_potvrzeni.sql (potvrzeno_at / stav='odehrano'),
--               063_vykaz_ppc.sql (vykaz_ppc_uzaverka + zámek editace)
--
-- Motivace:
--   Dosavadní „Přegenerovat" (K13) bylo čistě aditivní — jen doplnilo chybějící
--   bloky a vypsalo divergence. Ředitel ale potřebuje TVRDÝ RESET týdne dál na
--   šablonu: smazat, co je v rozsahu naklikáno (plánované i ručně zrušené bloky
--   VČETNĚ obsazení), a nahodit znovu ze šablony.
--
-- Co PŘEPIS smaže (pro danou třídu, v rozsahu od–do):
--   bloky ve stavu 'planovano' nebo 'zruseno', které NEJSOU potvrzené
--   (potvrzeno_at IS NULL) — ze šablony i ad hoc — přes ON DELETE CASCADE
--   i s rozvrh_obsazeni a rozvrh_blok_skupiny. Audit (061) mazání zaznamená.
--
-- Co PŘEPIS NIKDY nesmaže (jen je vrátí ve výpisu `kept` jako ponechané):
--   - potvrzené / odehrané bloky (potvrzeno_at / stav='odehrano') — visí na nich
--     třídnicový záznam a jdou do PPČ,
--   - bloky v uzamčeném měsíci PPČ (vykaz_ppc_uzaverka) — DB zámek z 063 by je
--     stejně nepustil smazat,
--   - bloky sdílené s jinou třídou (sloučená výuka, K5) — smazání by poškodilo
--     rozvrh druhé třídy; řeší se ručně.
--
-- Bezpečnost:
--   - jen ředitel (is_director()); jinak výjimka,
--   - běží jako invoker (NENÍ SECURITY DEFINER) → RLS director-only z 061 platí,
--   - uzamčené a potvrzené bloky se z mazání vyřadí PŘED DELETE, takže zámek/
--     audit trigger nikdy nezvednou výjimku a transakce neselže.
--
-- Součástí je i CREATE OR REPLACE generate_rozvrh() — přidán skip uzamčených
--   měsíců. Do uzamčeného měsíce stejně nešlo vložit (trigger z 063), dřív by to
--   ale shodilo celou regeneraci; nově se takový den bezpečně přeskočí. Chování
--   pro aditivní tlačítko se tím nemění (jen graceful skip místo chyby).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A. generate_rozvrh() — přidán skip uzamčených měsíců (jinak beze změny vůči 061)
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
    v_dow := EXTRACT(ISODOW FROM v_cur);  -- 1=Po … 7=Ne
    -- přeskoč víkend, den bez výuky a uzamčený měsíc PPČ
    IF v_dow <= 5
       AND NOT EXISTS (SELECT 1 FROM school_holidays WHERE datum = v_cur)
       AND NOT EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka WHERE obdobi = to_char(v_cur, 'YYYY-MM'))
    THEN
      FOR v_sab IN
        SELECT * FROM rozvrh_blok_sablona
         WHERE group_id = p_group_id
           AND den_v_tydnu = v_dow
           AND valid_from <= v_cur
           AND (valid_to IS NULL OR valid_to >= v_cur)
      LOOP
        -- už existuje materializace této šablony na tento den?
        SELECT id INTO v_blok_id FROM rozvrh_blok
          WHERE sablona_id = v_sab.id AND datum = v_cur;
        IF v_blok_id IS NULL THEN
          INSERT INTO rozvrh_blok (datum, school_year, cas_od, cas_do, nazev, typ_bloku, sablona_id)
            VALUES (v_cur, v_sab.school_year, v_sab.cas_od, v_sab.cas_do, v_sab.nazev, v_sab.typ_bloku, v_sab.id)
            RETURNING id INTO v_blok_id;
          INSERT INTO rozvrh_blok_skupiny (blok_id, group_id)
            VALUES (v_blok_id, p_group_id) ON CONFLICT DO NOTHING;
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
-- B. pregenerovat_rozvrh_prepis() — destruktivní reset rozsahu na šablonu
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
  -- Destruktivní operace → jen ředitel.
  IF NOT is_director() THEN
    RAISE EXCEPTION 'Jen ředitel může přepsat rozvrh ze šablony.';
  END IF;
  IF p_date_from > p_date_to THEN
    RAISE EXCEPTION 'date_from (%) musí být <= date_to (%).', p_date_from, p_date_to;
  END IF;

  -- 1) Klasifikace bloků třídy v rozsahu → smazat vs. ponechat (s důvodem).
  --    Vše na jednom snapshotu; klíčové je, že uzamčené a potvrzené bloky se
  --    z mazání vyřadí, takže zámek/audit trigger nikdy nespadnou.
  WITH cand AS (
    SELECT b.id, b.datum, b.cas_od, b.cas_do, b.nazev, b.stav, b.potvrzeno_at,
           EXISTS (SELECT 1 FROM vykaz_ppc_uzaverka u
                     WHERE u.obdobi = to_char(b.datum, 'YYYY-MM'))           AS locked,
           EXISTS (SELECT 1 FROM rozvrh_blok_skupiny s2
                     WHERE s2.blok_id = b.id AND s2.group_id <> p_group_id)  AS shared
      FROM rozvrh_blok b
      JOIN rozvrh_blok_skupiny s ON s.blok_id = b.id AND s.group_id = p_group_id
     WHERE b.datum BETWEEN p_date_from AND p_date_to
  ),
  classified AS (
    SELECT c.*,
           CASE
             WHEN c.potvrzeno_at IS NOT NULL OR c.stav = 'odehrano' THEN 'confirmed'
             WHEN c.locked THEN 'locked'
             WHEN c.shared THEN 'shared'
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

  -- 2) Čerstvá materializace ze šablony (aditivně nad prázdno po mazání;
  --    uzamčené měsíce a víkendy generate_rozvrh přeskočí).
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
-- Ověřovací dotazy (spustit samostatně po migraci):
--   SELECT proname FROM pg_proc WHERE proname = 'pregenerovat_rozvrh_prepis';  -- 1 řádek
--   -- Suchý test klasifikace (NIC nemaže) pro třídu <group_uuid>:
--   -- WITH cand AS (SELECT b.*, EXISTS(SELECT 1 FROM vykaz_ppc_uzaverka u WHERE u.obdobi=to_char(b.datum,'YYYY-MM')) locked
--   --   FROM rozvrh_blok b JOIN rozvrh_blok_skupiny s ON s.blok_id=b.id AND s.group_id='<group_uuid>'
--   --   WHERE b.datum BETWEEN '2026-09-07' AND '2026-10-31')
--   -- SELECT datum, nazev, stav, potvrzeno_at, locked FROM cand ORDER BY datum;
-- =============================================================================
