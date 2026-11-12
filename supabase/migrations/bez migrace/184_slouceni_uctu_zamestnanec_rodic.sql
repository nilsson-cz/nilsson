-- =============================================================================
-- Migrace 184 — sloučení dvojích účtů zaměstnanec + rodič na ŠKOLNÍ účet
-- Datum: 2026-11-12 (jednorázová datová migrace; idempotentní — opakované
-- spuštění nic nezmění, protože staré účty už v přepisovaných sloupcích nebudou)
--
-- Rozhodnutí ředitele 2026-11-12: u 5 lidí s KONFLIKT_DVA_UCTY (jména záměrně
-- neuvedena — soubor jde do veřejného snapshotu)
-- (scripts/audit-zamestnanec-rodic.sql) zůstává přihlašovací účet zaměstnance
-- (školní e-mail). Rodičovský záznam se napojí na něj; guardians.email
-- (soukromý) se NEMĚNÍ → pošta pro rodiče chodí dál na soukromou adresu.
--
-- Výskyty starých rodičovských účtů (scripts/audit-slouceni-uctu.sql):
--   PŘEPISUJE SE:   guardians.user_id (5), lunch_orders.created_by (289),
--                   lunch_orders.cancelled_by (23), consent_records.decided_by (79),
--                   druzina_denni_zmeny.created_by (48), enrollment_guardians.auth_user_id (1)
--   NEPŘEPISUJE SE: essl_transakce.uzivatel_id (8), guardians_audit.changed_by (4)
--     → neměnné auditní deníky (essl_transakce má pravidlo ON UPDATE DO INSTEAD,
--       UPDATE odmítne); zůstává v nich původní účet = historicky přesný záznam.
--     → proto starý účet nejspíš NEPŮJDE smazat (FK) → krok E: zablokovat.
--
-- SKUTEČNÝ PRŮBĚH 2026-11-12: první verze (temp tabulka + jednotlivé UPDATE) přes
-- hlášenou chybu přepsala vše kromě essl_transakce — včetně guardians_audit (pravidlo
-- tedy nemá). Ověřeno skenem přes soukromé e-maily: zbývá jen essl_transakce (8).
-- Tato verze B pak vrátila samé nuly (nic k přepisu) — je jen pro opakovatelnost.
--
-- SQL editor dashboardu spouští příkazy JEDNOTLIVĚ (autocommit) → BEGIN/COMMIT
-- nic neobalí. Přepis je proto JEDEN příkaz (datové CTE) = atomický sám o sobě.
-- Triggery se vypínají/zapínají samostatnými kroky A a C.
--
-- POSTUP (každý krok zvlášť):
--   0) kontrola pravidel (rules) — musí vrátit 0 řádků
--   A) vypnout uživatelské triggery
--   B) přepis (vrátí počty)
--   C) zapnout triggery — SPUSTIT VŽDY, i když B selže!
--   D) ověření
--   E) staré účty: smazat, nebo (při chybě FK) zablokovat
--
-- SQL editor: bez rovných dvojitých uvozovek a znaku dolaru. db:types netřeba.
-- =============================================================================


-- ── 0) Kontrola: přepisované tabulky nesmí mít pravidla (rules) → 0 řádků ───
SELECT tablename, rulename, definition
  FROM pg_rules
 WHERE schemaname = 'public'
   AND tablename IN ('guardians','lunch_orders','consent_records','druzina_denni_zmeny','enrollment_guardians');


-- ── A) Vypnout uživatelské triggery (FK kontroly zůstávají) ─────────────────
ALTER TABLE lunch_orders         DISABLE TRIGGER USER;
ALTER TABLE consent_records      DISABLE TRIGGER USER;
ALTER TABLE druzina_denni_zmeny  DISABLE TRIGGER USER;
ALTER TABLE guardians            DISABLE TRIGGER USER;
ALTER TABLE enrollment_guardians DISABLE TRIGGER USER;


-- ── B) Přepis — JEDEN příkaz (všechny CTE vidí stejný snímek dat) ───────────
WITH mapa AS (
  SELECT g.user_id AS stare_uid, s.user_id AS nove_uid
    FROM (VALUES
      ('a77307e3-4518-4cd7-ba32-945e185cb461'::uuid, '65b88cb3-94c3-4789-a720-6d359ec80f59'::uuid),  -- osoba 1
      ('82e3d52f-a2fc-4d9e-a0cf-0fcf30d5a731'::uuid, '31d4ae4e-03d3-4b52-9b3e-dd2a506a9acd'::uuid),  -- osoba 2
      ('30dfee8d-2288-4332-99d4-483b3bafa945'::uuid, '606f8c4e-3339-4ad9-98df-31a0478425cd'::uuid),  -- osoba 3
      ('62ac6d1a-c5d2-4da5-8b8b-beb93866e883'::uuid, '8e2b7b15-d780-4305-8943-8db167e8d96f'::uuid),  -- osoba 4
      ('ebb4b3b6-8202-431d-9ad8-a9e1fc8edcd1'::uuid, '439d3a58-a878-44d0-876b-8b07523cdfae'::uuid)   -- osoba 5
    ) AS p(guardian_id, staff_id)
    JOIN guardians g ON g.id = p.guardian_id
    JOIN staff s     ON s.id = p.staff_id
   WHERE g.user_id IS NOT NULL AND s.user_id IS NOT NULL AND g.user_id <> s.user_id
),
u_obedy AS (   -- oba sloupce v jednom UPDATE (týž řádek nelze v jednom příkazu měnit dvakrát)
  UPDATE lunch_orders t
     SET created_by   = coalesce((SELECT nove_uid FROM mapa WHERE stare_uid = t.created_by),   t.created_by),
         cancelled_by = coalesce((SELECT nove_uid FROM mapa WHERE stare_uid = t.cancelled_by), t.cancelled_by)
   WHERE t.created_by IN (SELECT stare_uid FROM mapa) OR t.cancelled_by IN (SELECT stare_uid FROM mapa)
  RETURNING 1
),
u_souhlasy AS (
  UPDATE consent_records t SET decided_by = m.nove_uid FROM mapa m WHERE t.decided_by = m.stare_uid RETURNING 1
),
u_druzina AS (
  UPDATE druzina_denni_zmeny t SET created_by = m.nove_uid FROM mapa m WHERE t.created_by = m.stare_uid RETURNING 1
),
u_zapis AS (
  UPDATE enrollment_guardians t SET auth_user_id = m.nove_uid FROM mapa m WHERE t.auth_user_id = m.stare_uid RETURNING 1
),
u_rodice AS (
  UPDATE guardians t SET user_id = m.nove_uid FROM mapa m WHERE t.user_id = m.stare_uid RETURNING 1
)
SELECT (SELECT count(*) FROM mapa)       AS paru,          -- 5
       (SELECT count(*) FROM u_obedy)    AS lunch_orders,  -- ~289 (část má i cancelled_by)
       (SELECT count(*) FROM u_souhlasy) AS consent_records,
       (SELECT count(*) FROM u_druzina)  AS druzina_denni_zmeny,
       (SELECT count(*) FROM u_zapis)    AS enrollment_guardians,
       (SELECT count(*) FROM u_rodice)   AS guardians;      -- 5


-- ── C) Zapnout triggery — SPUSTIT VŽDY (i po chybě v B) ──────────────────────
--    (essl_transakce a guardians_audit zapnout taky — vypnula je 1. verze kroku A)
ALTER TABLE lunch_orders         ENABLE TRIGGER USER;
ALTER TABLE consent_records      ENABLE TRIGGER USER;
ALTER TABLE druzina_denni_zmeny  ENABLE TRIGGER USER;
ALTER TABLE guardians            ENABLE TRIGGER USER;
ALTER TABLE enrollment_guardians ENABLE TRIGGER USER;
ALTER TABLE essl_transakce       ENABLE TRIGGER USER;
ALTER TABLE guardians_audit      ENABLE TRIGGER USER;


-- ── D) Ověření ───────────────────────────────────────────────────────────────
-- D1) Žádný vypnutý trigger (0 řádků):
--   SELECT tgrelid::regclass AS tabulka, tgname, tgenabled FROM pg_trigger
--    WHERE NOT tgisinternal AND tgenabled = 'D'
--      AND tgrelid::regclass::text IN ('lunch_orders','consent_records','druzina_denni_zmeny',
--          'essl_transakce','guardians','guardians_audit','enrollment_guardians');
-- D2) scripts/audit-zamestnanec-rodic.sql — těchto 5 lidí = OK_JEDEN_UCET.


-- ── E) Staré (soukromé) účty ────────────────────────────────────────────────
-- Zkusit smazat v Authentication → Users (soukromé e-maily z ověření 0).
-- Pokud smazání selže kvůli FK z essl_transakce/guardians_audit, účet ZABLOKOVAT
-- (přihlášení soukromým e-mailem pak nejde, auditní stopa zůstává):
--   UPDATE auth.users SET banned_until = 'infinity'
--    WHERE email IN ('…soukromý e-mail 1…', '…', '…', '…', '…')
--      AND id NOT IN (SELECT user_id FROM staff WHERE user_id IS NOT NULL)
--      AND id NOT IN (SELECT user_id FROM guardians WHERE user_id IS NOT NULL);
-- (Podmínky NOT IN = pojistka, aby se nikdy nezablokoval živý účet.)
-- =============================================================================
