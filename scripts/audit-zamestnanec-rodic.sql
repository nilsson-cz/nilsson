-- =============================================================================
-- Audit: zaměstnanci, kteří jsou zároveň zákonnými zástupci / rodiči
-- Účel: podklad pro jednotné přihlášení + přepínač rolí Škola / Rodič (v4.x).
-- Jen čtení (SELECT), spustit v Supabase SQL Editoru. Nic nemění.
--
-- Kategorie:
--   OK_JEDEN_UCET      — staff i guardian ukazují na stejný auth účet (user_id)
--   OK_STEJNY_EMAIL    — stejný e-mail, guardian ještě nenapárovaný; první
--                        přihlášení do portálu ho napáruje (get_or_link_guardian_self)
--   KONFLIKT_DVA_UCTY  — oba mají user_id, ale RŮZNÉ → dvě identity, nutno sloučit
--   KONFLIKT_JINY_EMAIL— shoda jména, jiný e-mail → pravděpodobně táž osoba,
--                        ověřit ručně (může jít i o shodu jmen)
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- =============================================================================

WITH s AS (
  SELECT id, first_name, last_name, lower(trim(email)) AS email, user_id, employment_end
    FROM staff
   WHERE employment_end IS NULL OR employment_end >= current_date
),
g AS (
  SELECT id, first_name, last_name, lower(trim(email)) AS email, user_id
    FROM guardians
),
pary AS (
  SELECT s.id AS staff_id, g.id AS guardian_id,
         s.last_name || ' ' || s.first_name AS zamestnanec,
         g.last_name || ' ' || g.first_name AS rodic,
         s.email AS staff_email, g.email AS guardian_email,
         s.user_id AS staff_uid, g.user_id AS guardian_uid
    FROM s
    JOIN g
      ON (s.user_id IS NOT NULL AND s.user_id = g.user_id)
      OR (g.email IS NOT NULL AND s.email = g.email)
      OR (lower(s.first_name) = lower(g.first_name) AND lower(s.last_name) = lower(g.last_name))
)
SELECT
  CASE
    WHEN staff_uid IS NOT NULL AND staff_uid = guardian_uid                  THEN 'OK_JEDEN_UCET'
    WHEN staff_uid IS NOT NULL AND guardian_uid IS NOT NULL                  THEN 'KONFLIKT_DVA_UCTY'
    WHEN staff_email = guardian_email                                        THEN 'OK_STEJNY_EMAIL'
    ELSE                                                                          'KONFLIKT_JINY_EMAIL'
  END AS kategorie,
  zamestnanec, rodic, staff_email, guardian_email,
  staff_uid IS NOT NULL    AS staff_ma_ucet,
  guardian_uid IS NOT NULL AS rodic_ma_ucet,
  staff_id, guardian_id
FROM pary
ORDER BY 1, 2;

-- Souhrn po kategoriích (spustit samostatně, nebo jen se podívat na výsledek výše):
-- SELECT kategorie, count(*) FROM ( …dotaz výše… ) x GROUP BY 1 ORDER BY 1;
