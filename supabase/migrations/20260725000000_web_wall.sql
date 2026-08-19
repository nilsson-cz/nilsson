-- =============================================================================
-- Migrace: Zeď "Ze života školy" — ověřovací funkce pro middleware
-- Schéma: web (access_tokens už existuje, viz Data API exposed schemas)
--
-- SECURITY DEFINER: anon smí funkce VOLAT (execute), ale NEVIDÍ do
-- web.access_tokens (žádný anon SELECT na tabulku). Ověřuje se podle hashe.
-- Middleware a brána /zivot jsou samostatný další krok — zatím jen tyto
-- dvě RPC pro budoucí ověřování tokenu.
-- =============================================================================

CREATE OR REPLACE FUNCTION web.verify_access_token(p_hash TEXT)
RETURNS TABLE (token_id UUID, school_year TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = web, public AS $$
  SELECT id, school_year
  FROM web.access_tokens
  WHERE token_hash = p_hash AND revoked_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION web.access_token_valid(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = web, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM web.access_tokens
    WHERE id = p_id AND revoked_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION web.verify_access_token(text) FROM public;
REVOKE ALL ON FUNCTION web.access_token_valid(uuid) FROM public;
GRANT EXECUTE ON FUNCTION web.verify_access_token(text), web.access_token_valid(uuid)
  TO anon, authenticated;
