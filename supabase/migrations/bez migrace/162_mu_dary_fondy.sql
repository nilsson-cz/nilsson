-- =============================================================================
-- Migrace 162 — Manažerské účetnictví: darové fondy a účet dotací KÚ
-- Datum: 2026-10-21 (idempotentní)
-- Prerekvizity: 154 (mu_nastaveni).
--
-- CO DĚLÁ (mu_nastaveni):
--   dar_fondy        — účty fondů (třída 9), jejichž přírůstek (DAL) je příjem
--                      v kategorii Dary; výchozí 911400 (dary na vybavení) a
--                      911500 (dary na zkvalitnění vzdělávání). Rezervní fond
--                      a fond investic (převody zisku) sem nepatří.
--   dotace_ucet      — účet, na který účetní přijímá zálohy dotace od KÚ
--                      (výchozí 346); Kontrola porovná přijaté platby s nárokem
--                      z Veřejných financí.
--
-- SQL editor dashboardu: bez rovných dvojitých uvozovek a znaku dolaru.
-- Spustit RUČNĚ v Supabase. Po spuštění: npm run db:types
-- =============================================================================

BEGIN;

ALTER TABLE mu_nastaveni ADD COLUMN IF NOT EXISTS dar_fondy TEXT[] NOT NULL DEFAULT ARRAY['911400','911500'];
ALTER TABLE mu_nastaveni ADD COLUMN IF NOT EXISTS dotace_ucet TEXT NOT NULL DEFAULT '346'
  CHECK (dotace_ucet ~ '^[0-9]{1,6}$');

COMMIT;
