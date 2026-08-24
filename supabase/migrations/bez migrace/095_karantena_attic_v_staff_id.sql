-- =============================================================================
--  095 — Karanténa náhodné tabulky-ducha v_staff_id (RENAME TO _attic_)
-- =============================================================================
--  Zdroj:  scripts/db-audit.sql blok #2b (tabulka bez RLS), run 2026-08-24.
--
--  PŮVOD:  vznikla omylem. `SELECT id INTO v_staff_id FROM staff ...` spuštěné
--          v SQL editoru MIMO plpgsql funkci = `CREATE TABLE AS` (SELECT INTO
--          footgun). Prázdná (auth.uid() v editoru NULL), bez indexů, bez RLS.
--
--  OVĚŘENO:  n_live_tup = 0. Všech 30+ výskytů `v_staff_id` v kódu/migracích jsou
--          LOKÁLNÍ plpgsql proměnné (konvence v_), NE odkaz na tabulku. RENAME
--          proto nemá na žádnou funkci vliv (jmenná shoda s proměnnou je náhoda).
--          Blok #1 (detektor duchů) ji minul — název je v prosrc funkcí jako
--          proměnná → in_funcs>0 → false negative. Chytil až #2b (bez RLS).
--
--  ZLATÉ PRAVIDLO:  reverzibilní karanténa. Po 1–2 týdnech → DROP.
--          Rollback:  ALTER TABLE public._attic_v_staff_id RENAME TO v_staff_id;
-- =============================================================================

alter table public.v_staff_id rename to _attic_v_staff_id;

-- =============================================================================
--  Pozn.: ds_zpravy (blok #2, RLS on + 0 politik) NENÍ součástí této migrace —
--  je to ZÁMĚR: čistě backendová tabulka (scripts/isds-poll.ts pod service role),
--  deny-all pro klienty je správná pozice. Policy doplnit až s případným UI.
-- =============================================================================
