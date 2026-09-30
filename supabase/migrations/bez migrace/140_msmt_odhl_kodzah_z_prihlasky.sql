-- =============================================================================
-- Migrace 140 — ODHL a KOD_ZAH předvyplněné z přihlášky (číselníky RAPD, RAZD)
-- Datum: 2026-09-30 (idempotentní)
-- PRD: Nilsson_documentation/daily_notes/PRD-predchozi-skola-rejstrik-2026-09-29.md (R4)
-- Prerekvizity: 139 (enrollment_msmt_predvyplneni, predchozi_skola_*).
--
-- CO DĚLÁ: nahrazuje tělo enrollment_msmt_predvyplneni (signatura beze změny,
-- enrollment_migrate_to_student se nemění).
--
-- ODHL (RAPD — předchozí vzdělávání):
--   zahraniční škola (zápis i přestup)          → 600
--   zápis, MŠ z rejstříku / „nemohu najít“      → 010  Mateřská škola
--   zápis, nechodilo do MŠ                      → NULL (RAPD nemá „nechodil“;
--                                                  900 Jiné rozhodne ředitel)
--   přestup ze ZŠ do n. ročníku                 → 10k  ZŠ – z k. ročníku (k = 10 → 10A)
--       nástup na začátku školního roku (červenec, srpen, 1.–3. září):
--         k = n − 1 (žák předchozí ročník dokončil jinde)
--       nástup během roku: k = n (žák přechází v rámci ročníku)
--       k mimo 1–10 nebo neznámé datum nástupu  → NULL
--   ZŠ speciální (12x) a ostatní kódy se neodvozují — opraví ředitel.
--
-- KOD_ZAH (RAZD — zahájení docházky):
--   zápis → 1 (řádný termín), s odkladem z loňska (melo_odklad) → 2
--   přestup → E (přestup z jiné školy)
--   3 (dvouletý odklad), H, P, U se neodvozují — opraví ředitel.
--
-- Datum nástupu: poslední rozhodnutí přihlášky s datum_nastupu, jinak prestup_k_datu.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek.
-- Spustit RUČNĚ v Supabase. Typy se nemění.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION enrollment_msmt_predvyplneni(p_app enrollment_applications)
RETURNS TABLE (izop TEXT, odhl TEXT, kod_zahajeni TEXT)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH nastup AS (
    SELECT COALESCE(
      (SELECT d.datum_nastupu FROM enrollment_decisions d
        WHERE d.application_id = p_app.id AND d.datum_nastupu IS NOT NULL
        ORDER BY d.created_at DESC LIMIT 1),
      p_app.prestup_k_datu
    ) AS datum
  ),
  rocnik AS (
    SELECT CASE
      WHEN p_app.typ <> 'prestup' OR p_app.budouci_rocnik IS NULL OR n.datum IS NULL THEN NULL
      WHEN extract(month FROM n.datum) IN (7, 8)
        OR (extract(month FROM n.datum) = 9 AND extract(day FROM n.datum) <= 3)
        THEN p_app.budouci_rocnik - 1
      ELSE p_app.budouci_rocnik
    END AS k
    FROM nastup n
  )
  SELECT
    -- IZOP (migrace 139)
    CASE
      WHEN p_app.predchozi_skola_volba = 'rejstrik'
       AND EXISTS (SELECT 1 FROM skolsky_rejstrik r
                    WHERE r.izo = p_app.predchozi_skola_izo AND r.zanikla_k IS NOT NULL)
        THEN '000000203'
      WHEN p_app.predchozi_skola_volba IN ('rejstrik', 'nechodilo', 'zahranici')
        THEN p_app.predchozi_skola_izo
    END,
    -- ODHL (RAPD)
    CASE
      WHEN p_app.predchozi_skola_volba = 'zahranici' THEN '600'
      WHEN p_app.typ = 'prestup' THEN
        CASE
          WHEN r.k BETWEEN 1 AND 9 THEN '10' || r.k::TEXT
          WHEN r.k = 10 THEN '10A'
        END
      WHEN p_app.predchozi_skola_volba IN ('rejstrik', 'nenalezeno') THEN '010'
    END,
    -- KOD_ZAH (RAZD)
    CASE
      WHEN p_app.typ = 'prestup' THEN 'E'
      WHEN p_app.melo_odklad THEN '2'
      ELSE '1'
    END
  FROM rocnik r
$$;

COMMENT ON FUNCTION enrollment_msmt_predvyplneni(enrollment_applications) IS
  'IZOP/ODHL(RAPD)/KOD_ZAH(RAZD) pro nového žáka z přihlášky (volá enrollment_migrate_to_student). Zaniklá škola → 000000203. Migrace 139, mapování 140.';

COMMIT;

-- =============================================================================
-- Ověření (poslední přijaté přihlášky — co by se předvyplnilo):
--   SELECT a.typ, a.budouci_rocnik, a.melo_odklad, a.predchozi_skola_volba, p.*
--     FROM enrollment_applications a
--     CROSS JOIN LATERAL enrollment_msmt_predvyplneni(a) p
--    ORDER BY a.created_at DESC LIMIT 10;
-- =============================================================================
