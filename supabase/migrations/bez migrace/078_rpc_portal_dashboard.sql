-- =============================================================================
-- Migrace 078: RPC pro dashboard rodičovského portálu
-- Datum: 2026-08-15
-- Závislosti:
--   019 guardian_auth  (current_guardian_id, is_guardian)
--   003 payments       (payment_obligations, payment_matches)
--   001 matrika        (students.kod_zaka, student_guardian_links)
--   025 bulletin       (bulletin_posts, bulletin_post_recipients)
--
-- Důvod: app/portal/page.tsx (dashboard portálu) volala dvě RPC, které nikdy
-- nebyly implementované → widgety „nezaplacené pohledávky" a „nástěnka" tiše
-- ukazovaly prázdno (0 Kč / žádné zprávy) — pravděpodobně od začátku. Byly
-- naplánované dle TRD (Platební modul §4.2, Bulletin), ale nikdy nasazené.
-- Tato migrace je doplňuje a odblokovává burndown `(supabase as any)`.
--
-- Kanonický RPC vzor dle 028/035 (SECURITY DEFINER + STABLE + search_path,
-- rodič rozlišen přes current_guardian_id(); PostgREST JWT workaround —
-- @supabase/ssr server kontext nepředá JWT správně pro guardian RLS přes .from()).
-- Hardening dle 077 / SECDEF nálezu: REVOKE ALL FROM PUBLIC, GRANT jen authenticated
-- (žádné EXECUTE pro anon).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) get_guardian_unpaid_receivables
--    Otevřené pohledávky napříč všemi aktivně navázanými dětmi rodiče.
--    Otevřená = uhrazeno (SUM matched_amount) < amount → vrací se ZBYTEK
--    k úhradě (amount − matched). Kredity/dobropisy (amount < 0) vypadnou
--    přes filtr remaining > 0.
--    Vazba na dítě: platnost_do IS NULL (aktivní link) — shodně s helperem
--    guardian_can_access_student (019). Nevyžaduje je_zakonny_zastupce:
--    platit/vidět dluh může kterýkoli aktivní zástupce (stejně jako /portal/platby).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_guardian_unpaid_receivables();

CREATE OR REPLACE FUNCTION get_guardian_unpaid_receivables()
RETURNS TABLE (
  id          UUID,
  description TEXT,
  amount_czk  NUMERIC,
  due_date    DATE,
  status      TEXT,
  vs          TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id UUID;
BEGIN
  v_guardian_id := current_guardian_id();

  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'get_guardian_unpaid_receivables: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  RETURN QUERY
  WITH my_students AS (
    SELECT sgl.student_id
    FROM student_guardian_links sgl
    WHERE sgl.guardian_id = v_guardian_id
      AND sgl.platnost_do IS NULL
  ),
  matched AS (
    SELECT pm.obligation_id, COALESCE(SUM(pm.matched_amount), 0) AS paid
    FROM payment_matches pm
    GROUP BY pm.obligation_id
  )
  SELECT
    po.id,
    COALESCE(NULLIF(btrim(po.popis), ''), 'Pohledávka')     AS description,
    (po.amount - COALESCE(m.paid, 0))                        AS amount_czk,
    po.due_date,
    CASE
      WHEN po.due_date <  CURRENT_DATE     THEN 'overdue'
      WHEN po.due_date <= CURRENT_DATE + 7 THEN 'due'
      ELSE 'upcoming'
    END::TEXT                                                AS status,
    regexp_replace(s.kod_zaka, '^.*-', '')                   AS vs
  FROM payment_obligations po
  JOIN my_students ms ON ms.student_id = po.student_id
  JOIN students    s  ON s.id          = po.student_id
  LEFT JOIN matched m  ON m.obligation_id = po.id
  WHERE (po.amount - COALESCE(m.paid, 0)) > 0
  ORDER BY po.due_date ASC;
END;
$$;

REVOKE ALL     ON FUNCTION get_guardian_unpaid_receivables() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_guardian_unpaid_receivables() TO authenticated;

COMMENT ON FUNCTION get_guardian_unpaid_receivables IS
  'Otevřené pohledávky (zbytek k úhradě) napříč aktivními dětmi přihlášeného '
  'rodiče. amount_czk = amount − SUM(matched); status: overdue / due (≤7 dní) / '
  'upcoming; vs = poslední segment kod_zaka. Kanonický guardian RPC vzor (028/035).';


-- ---------------------------------------------------------------------------
-- 2) get_guardian_bulletin_posts
--    Posledních p_limit ODESLANÝCH příspěvků nástěnky, kde je rodič příjemcem.
--    body_preview = prvních 120 znaků body.
--    Stav přečtení se NESLEDUJE (produkt nemá read-receipty; bulletin_post_recipients
--    nemá read_at) → shape bez is_read. Rozhodnutí 2026-08-15: dashboard místo
--    „nepřečtených" ukazuje počet posledních zpráv (zjednodušený scope).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_guardian_bulletin_posts(INTEGER);

CREATE OR REPLACE FUNCTION get_guardian_bulletin_posts(
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id           UUID,
  title        TEXT,
  body_preview TEXT,
  published_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guardian_id UUID;
BEGIN
  v_guardian_id := current_guardian_id();

  IF v_guardian_id IS NULL THEN
    RAISE EXCEPTION 'get_guardian_bulletin_posts: přihlášený uživatel není guardian (uid=%)', auth.uid();
  END IF;

  RETURN QUERY
    SELECT
      bp.id,
      bp.title,
      left(bp.body, 120) AS body_preview,
      bp.email_sent_at   AS published_at
    FROM bulletin_posts bp
    INNER JOIN bulletin_post_recipients bpr
      ON bpr.post_id     = bp.id
     AND bpr.guardian_id = v_guardian_id
    WHERE bp.email_sent_at IS NOT NULL
    ORDER BY bp.email_sent_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 5), 0);
END;
$$;

REVOKE ALL     ON FUNCTION get_guardian_bulletin_posts(INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_guardian_bulletin_posts(INTEGER) TO authenticated;

COMMENT ON FUNCTION get_guardian_bulletin_posts IS
  'Posledních p_limit odeslaných postů nástěnky pro přihlášeného rodiče '
  '(email_sent_at IS NOT NULL, řazeno DESC). body_preview = prvních 120 znaků body. '
  'Bez sledování přečtení (produkt nemá read-receipty). Guardian RPC vzor (028).';


-- ---------------------------------------------------------------------------
-- Sanity check (spustit manuálně po nasazení):
-- ---------------------------------------------------------------------------
-- SELECT proname, prosecdef, provolatile, proconfig
--   FROM pg_proc JOIN pg_namespace n ON n.oid = pronamespace
--  WHERE n.nspname = 'public'
--    AND proname IN ('get_guardian_unpaid_receivables', 'get_guardian_bulletin_posts');
-- Očekáváno: prosecdef=true, provolatile='s', proconfig obsahuje 'search_path=public'
--
-- Anon NESMÍ mít EXECUTE:
-- SELECT has_function_privilege('anon', 'get_guardian_unpaid_receivables()', 'EXECUTE'); -- false
-- SELECT has_function_privilege('anon', 'get_guardian_bulletin_posts(integer)', 'EXECUTE'); -- false
--
-- Po nasazení: `npm run db:types` → git diff types/database.ts musí být PRÁZDNÝ
-- (ruční předtypování v této PR se musí shodovat s generátorem).
