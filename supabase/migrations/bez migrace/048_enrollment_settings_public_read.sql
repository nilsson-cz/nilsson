-- =============================================================
-- Migrace 048 — veřejné čtení enrollment_settings
-- IS Nilsson · ZŠ Vilekula Teplice
--
-- POTVRZENÝ bug (diagnostický dotaz na pg_policies): na enrollment_settings
-- existovaly jen dvě politiky —
--   enrollment_settings_director_write (UPDATE, jen ředitel)
--   enrollment_settings_staff_read     (SELECT, jen personál)
-- Žádná politika nedovolovala běžnému přihlášenému rodiči (natož
-- nepřihlášenému zájemci) tabulku vůbec číst. Pod FORCE RLS to znamená:
-- SELECT z /zapis (landing), /zapis/nova (kontrola okna před založením
-- žádosti) a odvodRokZapisu() v app/actions/enrollment.ts vždy vrátil
-- nic, bez ohledu na skutečnou hodnotu zapis_otevren — což se projevilo
-- jako "zápis není otevřený" i při zapis_otevren=true, a v důsledku
-- (přesměrování dřív, než se zavolala enrollment_create_application)
-- jako "no rows" v enrollment_applications.
--
-- enrollment_settings obsahuje jen provozní metadata (zapis_otevren,
-- okno_od, okno_do) — žádná citlivá data, veřejné čtení je bezpečné.
-- Zájemce o zápis navíc legitimně potřebuje vědět, jestli je okno
-- otevřené, ještě předtím, než má vlastní guardian účet.
-- =============================================================

CREATE POLICY enrollment_settings_public_read ON enrollment_settings
  FOR SELECT
  USING (true);

COMMENT ON POLICY enrollment_settings_public_read ON enrollment_settings IS
  'Veřejné čtení (i anon) — enrollment_settings obsahuje jen provozní '
  'metadata (okno zápisu), žádná citlivá data. Zájemce o zápis potřebuje '
  'vědět, jestli je okno otevřené, ještě než má guardian účet. Doplněno '
  'migrací 048 po nálezu, že chybějící politika způsobovala falešné '
  '"zápis není otevřený" pro běžné (ne-personálové) uživatele.';

GRANT SELECT ON enrollment_settings TO anon, authenticated;
