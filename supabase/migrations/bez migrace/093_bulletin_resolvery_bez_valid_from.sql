-- =============================================================================
-- Migrace 093 — Bulletin resolvery: cílit celý školní rok, ne jen "už začatá"
--                členství (odstranění guardu valid_from <= CURRENT_DATE)
-- Datum: 2026-08-23
--
-- PROBLÉM (nalezeno 2026-08-23):
--   Formulář nového bulletinu po výběru třídy nabízel 0 příjemců a odeslání
--   rodičům nešlo. Příčina: oba resolvery filtrovaly členství podmínkou
--       gm.valid_from <= CURRENT_DATE
--   Členství pro nadcházející rok 2026/2027 mají valid_from = 2026-09-01, takže
--   před 1. 9. (typicky přes prázdniny, kdy se posílá onboarding) resolvery
--   vracely prázdno — jak pro příjemce (bulletin_resolve_recipients), tak pro
--   roster otevření (bulletin_resolve_target_students).
--
-- SÉMANTIKA PO OPRAVĚ:
--   "Všichni žáci přiřazení do cílené třídy pro CÍLENÝ školní rok, kteří ještě
--    neodešli." Rozlišení roku dělá gm.school_year (hlavní filtr) — z jiného roku
--   se nic nepřimíchá. Odhlášené žáky pořád vylučuje valid_to guard. Kalendářní
--   okno valid_from je pro cílení zpráv nesprávné kritérium → vypuštěno.
--
--   Během probíhajícího roku se chování NEmění (aktivní členové mají valid_from
--   v minulosti). Jediná změna: členství s BUDOUCÍM nástupem se nově zahrnou —
--   což je přesně žádané při psaní rodičům nové třídy přes prázdniny.
--
-- ROZSAH: oba resolvery upraveny shodně, aby roster zůstal konzistentní s tím,
--   komu e-mail reálně došel. Vše ostatní (staff guard v recipients, granty,
--   search_path, DISTINCT ON) zachováno 1:1 z 088 (recipients) a 082 (students).
--
-- Idempotence: CREATE OR REPLACE + REVOKE/GRANT → bezpečný re-run.
-- POZOR: pouze DB funkce → po spuštění platí OKAMŽITĚ pro živou app, bez deploye.
-- Spustit ručně v Supabase SQL editoru (viz [[migracni-workflow]]).
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- A) Příjemci (kopie 088, odstraněn řádek `AND gm.valid_from <= CURRENT_DATE`)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulletin_resolve_recipients(
    p_group_ids             UUID[],
    p_excluded_guardian_ids UUID[],
    p_school_year           TEXT
)
RETURNS TABLE (
    id         UUID,
    first_name TEXT,
    last_name  TEXT,
    email      TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_staff_id() IS NULL THEN
    RAISE EXCEPTION 'bulletin_resolve_recipients: pouze zaměstnanec';
  END IF;

  RETURN QUERY
    SELECT DISTINCT ON (g.id)
        g.id,
        g.first_name,
        g.last_name,
        g.email
    FROM group_memberships gm
    JOIN student_guardian_links sgl
        ON  sgl.student_id          = gm.student_id
        AND sgl.je_zakonny_zastupce = true
        AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    JOIN guardians g ON g.id = sgl.guardian_id
    WHERE gm.group_id    = ANY(p_group_ids)
      AND gm.school_year = p_school_year
      AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
      AND g.id != ALL(p_excluded_guardian_ids)
    ORDER BY g.id;
END;
$fn$;

REVOKE ALL     ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) TO authenticated;

COMMENT ON FUNCTION bulletin_resolve_recipients(uuid[], uuid[], text) IS
    'Vrátí DISTINCT zákonné zástupce žáků cílené třídy pro daný školní rok '
    '(bez ohledu na to, zda už rok začal; odhlášené vylučuje valid_to). '
    'Guard: current_staff_id() IS NOT NULL (jen personál). Volá lib/bulletin/recipients.ts. '
    'Migrace 093 odstranila valid_from guard (blokoval onboarding přes prázdniny).';

-- ─────────────────────────────────────────────────────────────
-- B) Roster žáků po třídách (kopie 082, odstraněn `AND gm.valid_from <= CURRENT_DATE`)
--    Drženo konzistentní s recipients, aby přehled otevření odpovídal příjemcům.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bulletin_resolve_target_students(
    p_group_ids   UUID[],
    p_school_year TEXT
)
RETURNS TABLE (student_id UUID, group_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT DISTINCT gm.student_id, gm.group_id
    FROM group_memberships gm
    WHERE gm.group_id    = ANY(p_group_ids)
      AND gm.school_year = p_school_year
      AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE);
$$;

REVOKE ALL     ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION bulletin_resolve_target_students(UUID[], TEXT) TO authenticated;

COMMENT ON FUNCTION bulletin_resolve_target_students IS
  'Vrátí DISTINCT (student, třída) cílené třídy pro daný školní rok '
  '(bez ohledu na to, zda už rok začal; odhlášené vylučuje valid_to). '
  'Zdroj rosteru bulletin_post_students. Voláno z create-route. '
  'Migrace 093 odstranila valid_from guard (konzistence s bulletin_resolve_recipients).';

COMMIT;

-- =============================================================================
-- Ověření (spustit po migraci):
--   -- roster resolver (bez staff guardu) musí pro 2026/2027 vrátit desítky řádků:
--   SELECT COUNT(*) FROM bulletin_resolve_target_students(
--     ARRAY(SELECT DISTINCT group_id FROM group_memberships WHERE school_year='2026/2027'),
--     '2026/2027');
--   -- v aplikaci: /dashboard/bulletin/new → vybrat třídu → náhled příjemců > 0.
-- =============================================================================
