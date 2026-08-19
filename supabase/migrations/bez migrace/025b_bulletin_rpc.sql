-- 025b_bulletin_rpc.sql
-- RPC funkce bulletin_resolve_recipients – volána z lib/bulletin/recipients.ts
-- Spustit po 025_bulletin.sql

CREATE OR REPLACE FUNCTION bulletin_resolve_recipients(
    p_group_ids             UUID[],
    p_excluded_guardian_ids UUID[],
    p_school_year           TEXT
)
RETURNS TABLE (
    id         UUID,
    first_name TEXT,
    last_name  TEXT,
    email      TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER   -- přeskočí RLS při volání z API route (server-side client)
AS $$
    SELECT DISTINCT ON (g.id)
        g.id,
        g.first_name,
        g.last_name,
        g.email
    FROM group_memberships gm
    JOIN student_guardian_links sgl
        ON  sgl.student_id          = gm.student_id
        AND sgl.je_zakonny_zastupce = true
        AND (sgl.platnost_do IS NULL OR sgl.platnost_do >= CURRENT_DATE)
    JOIN guardians g ON g.id = sgl.guardian_id
    WHERE gm.group_id    = ANY(p_group_ids)
      AND gm.school_year = p_school_year
      AND gm.valid_from  <= CURRENT_DATE
      AND (gm.valid_to IS NULL OR gm.valid_to >= CURRENT_DATE)
      AND g.id != ALL(p_excluded_guardian_ids)
    ORDER BY g.id;
$$;

-- Povol volání přihlášeným uživatelům (RLS se neuplatní díky SECURITY DEFINER)
REVOKE ALL    ON FUNCTION bulletin_resolve_recipients FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION bulletin_resolve_recipients TO authenticated;

COMMENT ON FUNCTION bulletin_resolve_recipients IS
    'Vrátí DISTINCT zákonné zástupce aktivních žáků v zadaných skupinách.'
    ' Použití: lib/bulletin/recipients.ts → resolveRecipients()';
