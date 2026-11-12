-- =============================================================================
-- Audit před sloučením účtů zaměstnanec + rodič (KONFLIKT_DVA_UCTY, 5 osob; jména záměrně neuvedena — soubor jde do veřejného snapshotu)
-- Jen čtení. Spustit v Supabase SQL Editoru (bez dolaru a dvojitých uvozovek).
--
-- Najde VŠECHNY sloupce typu uuid v public schématu (i bez FK na auth.users),
-- kde se vyskytuje rodičovský auth účet (guardians.user_id) těchto 5 lidí,
-- a spočítá řádky. Podle výsledku vznikne slučovací migrace: co se přepíše
-- na zaměstnanecký účet, co se smaže (např. duplicitní push odběr).
-- =============================================================================

WITH stare AS (
  SELECT g.user_id AS uid
    FROM guardians g
   WHERE g.id IN (
     'a77307e3-4518-4cd7-ba32-945e185cb461',  -- osoba 1
     '82e3d52f-a2fc-4d9e-a0cf-0fcf30d5a731',  -- osoba 2
     '30dfee8d-2288-4332-99d4-483b3bafa945',  -- osoba 3
     '62ac6d1a-c5d2-4da5-8b8b-beb93866e883',  -- osoba 4
     'ebb4b3b6-8202-431d-9ad8-a9e1fc8edcd1'   -- osoba 5
   ) AND g.user_id IS NOT NULL
),
seznam AS (
  SELECT string_agg(quote_literal(uid::text), ',') AS uids FROM stare
),
sloupce AS (
  SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.data_type = 'uuid'
),
pocty AS (
  SELECT s.table_name, s.column_name,
         (xpath('/row/c/text()',
           query_to_xml(
             format('SELECT count(*) AS c FROM public.%I WHERE %I::text IN (%s)', s.table_name, s.column_name, l.uids),
             false, true, '')))[1]::text::int AS radku
    FROM sloupce s CROSS JOIN seznam l
)
SELECT table_name AS tabulka, column_name AS sloupec, radku
  FROM pocty
 WHERE radku > 0
 ORDER BY radku DESC, 1, 2;

-- Kontrola (samostatně): staré rodičovské účty v auth — e-mail a poslední přihlášení
-- SELECT u.id, u.email, u.last_sign_in_at
--   FROM auth.users u JOIN guardians g ON g.user_id = u.id
--  WHERE g.id IN ('a77307e3-4518-4cd7-ba32-945e185cb461','82e3d52f-a2fc-4d9e-a0cf-0fcf30d5a731',
--                 '30dfee8d-2288-4332-99d4-483b3bafa945','62ac6d1a-c5d2-4da5-8b8b-beb93866e883',
--                 'ebb4b3b6-8202-431d-9ad8-a9e1fc8edcd1');
