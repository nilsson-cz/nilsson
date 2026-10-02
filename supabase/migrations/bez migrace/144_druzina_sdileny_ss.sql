-- =============================================================================
-- Migrace 144 — Družina: sdílený specifický symbol na školní rok
-- Datum: 2026-10-02 (JEDNA transakce; opakované spuštění je bezpečné)
-- Navazuje na: 058 (druzina_vytvorit_pohledavku), 077 (3param snapshot živé DB)
--
-- Kontext: stránka /dashboard/platby/akce sdružuje pohledávky výhradně podle
-- ss_kod. RPC druzina_vytvorit_pohledavku se volá zvlášť per žák a pokaždé
-- inkrementovala pořadí ('30' + YYYYMM schválení + NN) → každá družinová
-- pohledávka měla vlastní SS a na akcích tvořila skupinu po 1 žákovi.
-- Viz ARCH-NOTE-2026-08-12-platby-druzina-detail-a-ss-grupovani.
--
-- Řešení (stejný model jako obědy/školné — SS = dávka, žáka rozlišuje VS):
--   SS družiny = '30' + školní rok bez lomítka, např. 2026/2027 → 3020262027.
--   Pořád 10 číslic. S ručním generateSsKod() ('30' + YYYYMM + NN) nekoliduje:
--   na pozici měsíce je vždy '20' (začátek druhého letopočtu), což není měsíc.
--
-- Párování (cron fio-import) hledá pohledávku přes ss_kod AND student_id.
-- Unique index (student_id, school_year) WHERE type = 'druzina' zaručuje, že
-- i se sdíleným SS najde nejvýš jeden řádek. Hotové matche drží na
-- obligation_id, přepis SS je nerozbije.
--
-- Přepis existujících řádků: jen tam, kde je to bezpečné — pohledávka je plně
-- uhrazená, nebo o ní rodič ještě nedostal notifikaci. Nedoplacená pohledávka
-- s už odeslanou notifikací si starý SS NECHÁVÁ (rodič by zaplatil starým SS
-- a platba by se nespárovala). Kontrolní výpis na konci ukáže, jestli nějaká
-- taková zbyla.
--
-- Signatura RPC se nemění → `npm run db:types` není potřeba.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. druzina_vytvorit_pohledavku — sdílený SS místo pořadového čísla
--    Oproti 077 se mění jen výpočet v_ss_kod (advisory lock už není potřeba).
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.druzina_vytvorit_pohledavku(p_student_id uuid, p_school_year text, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ss_kod        text;
  v_created_by    uuid;   -- auth.users(id) — cílová hodnota pro FK
  v_obligation_id uuid;
BEGIN
  IF NOT is_director() THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: pouze ředitel může generovat pohledávky';
  END IF;

  -- Přeložíme staff.id -> auth user id (payment_obligations.created_by FK -> auth.users)
  SELECT user_id INTO v_created_by FROM staff WHERE id = p_created_by;
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: staff.id % nemá odpovídající user_id (auth.users)', p_created_by;
  END IF;

  -- SS kód: prefix '30' (družina) + školní rok bez lomítka — jeden sdílený kód
  -- pro všechny žáky v daném školním roce (úplata je jednorázová roční).
  -- (10=lunch, 70=tuition, 20=event/donation, 30=druzina)
  IF p_school_year !~ '^\d{4}/\d{4}$' THEN
    RAISE EXCEPTION 'druzina_vytvorit_pohledavku: neplatný školní rok % (očekáván formát RRRR/RRRR)', p_school_year;
  END IF;
  v_ss_kod := '30' || replace(p_school_year, '/', '');

  INSERT INTO payment_obligations (
    student_id, type, amount, currency, due_date, school_year,
    ss_kod, popis, created_by
  ) VALUES (
    p_student_id, 'druzina', 1000, 'CZK', CURRENT_DATE + INTERVAL '14 days', p_school_year,
    v_ss_kod, 'Úplata za školní družinu', v_created_by
  )
  ON CONFLICT (student_id, school_year) WHERE type = 'druzina' DO NOTHING
  RETURNING id INTO v_obligation_id;

  RETURN v_obligation_id;
END;
$function$;

COMMENT ON FUNCTION druzina_vytvorit_pohledavku(uuid, text, uuid) IS
  'Sdílená pomocná funkce pro vytvoření pohledávky za družinu (1000 Kč, splatnost +14 dní). '
  'SS kód je sdílený pro celý školní rok (''30'' + školní rok bez lomítka), žáka rozlišuje VS. '
  'p_created_by = staff.id autora (překládá se na staff.user_id kvůli FK created_by -> auth.users). '
  'Volaná z druzina_prihlaska_rozhodnout (prijato) i z enrollStudent() (ruční dohlášení). '
  'Vrací NULL, pokud pohledávka pro (student, školní rok) už existuje.';

-- -----------------------------------------------------------------------------
-- 2. Přepis SS u existujících družinových pohledávek
--    Jen plně uhrazené nebo dosud nenotifikované (viz hlavička).
-- -----------------------------------------------------------------------------

UPDATE payment_obligations o
   SET ss_kod = '30' || replace(o.school_year, '/', '')
 WHERE o.type = 'druzina'
   AND o.school_year ~ '^\d{4}/\d{4}$'
   AND o.ss_kod IS DISTINCT FROM '30' || replace(o.school_year, '/', '')
   AND (
     o.notified_at IS NULL
     OR o.amount <= (
       SELECT COALESCE(SUM(m.matched_amount), 0)
         FROM payment_matches m
        WHERE m.obligation_id = o.id
     )
   );

COMMIT;

-- -----------------------------------------------------------------------------
-- 3. Kontrolní výpis — očekávaný výsledek: jeden řádek na školní rok.
--    Řádky navíc (starý SS '30'+YYYYMM+NN) = nedoplacené pohledávky s odeslanou
--    notifikací, které si starý SS záměrně nechaly. Po jejich úhradě stačí
--    migraci pustit znovu.
-- -----------------------------------------------------------------------------

SELECT o.school_year,
       o.ss_kod,
       count(*)                                             AS pohledavek,
       count(*) FILTER (WHERE o.amount > COALESCE(p.paid, 0)) AS nedoplaceno
  FROM payment_obligations o
  LEFT JOIN LATERAL (
    SELECT SUM(m.matched_amount) AS paid
      FROM payment_matches m
     WHERE m.obligation_id = o.id
  ) p ON true
 WHERE o.type = 'druzina'
 GROUP BY o.school_year, o.ss_kod
 ORDER BY o.school_year, o.ss_kod;

-- =============================================================================
-- KONEC MIGRACE 144
-- =============================================================================
