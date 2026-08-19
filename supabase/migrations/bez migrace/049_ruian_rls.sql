-- Migration 049: Enable RLS on RUIAN reference tables
-- Fixes Supabase linter: rls_disabled_in_public
-- RUIAN tables (ruian_okresy, ruian_obce, ruian_adresni_mista) are read-only
-- reference data used for address validation during enrollment (Zápis/Přestup).
-- They must remain publicly readable (anon + authenticated), but RLS should
-- still be enabled per project convention (FORCE RLS everywhere).
-- Only service_role (import job) writes to these tables, and service_role
-- bypasses RLS by default, so no INSERT/UPDATE/DELETE policies are needed.

BEGIN;

-- ruian_okresy -----------------------------------------------------------
ALTER TABLE public.ruian_okresy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruian_okresy FORCE ROW LEVEL SECURITY;

CREATE POLICY "ruian_okresy_select_public"
  ON public.ruian_okresy
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ruian_obce ---------------------------------------------------------------
ALTER TABLE public.ruian_obce ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruian_obce FORCE ROW LEVEL SECURITY;

CREATE POLICY "ruian_obce_select_public"
  ON public.ruian_obce
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ruian_adresni_mista --------------------------------------------------------
ALTER TABLE public.ruian_adresni_mista ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruian_adresni_mista FORCE ROW LEVEL SECURITY;

CREATE POLICY "ruian_adresni_mista_select_public"
  ON public.ruian_adresni_mista
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMIT;
