-- =============================================================================
-- Migrace 168 — Tripartita: rezervaci vidí oba rodiče
--
-- Dosud tr_guardian_select (028) pouštěl jen rezervace, které rodič sám
-- vytvořil (guardian_id = current_guardian_id()). Druhý rodič téhož dítěte
-- rezervaci neviděl → dítě se mu v portálu tvářilo jako nerezervované
-- a pokus o rezervaci končil 'already_reserved'.
--
-- Nově rodič čte i rezervace dětí, ke kterým má přístup
-- (guardian_can_access_student = aktivní vazba + docházející dítě, 126).
-- Vlastní rezervace zůstávají viditelné i bez toho (původní podmínka).
-- =============================================================================

DROP POLICY IF EXISTS "tr_guardian_select" ON tripartita_reservations;

CREATE POLICY "tr_guardian_select" ON tripartita_reservations
  FOR SELECT USING (
    is_guardian()
    AND (
      guardian_id = current_guardian_id()
      OR guardian_can_access_student(student_id)
    )
  );

-- ── Sanity check (spustit samostatně po nasazení) ─────────────────────────────
--
-- SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--  WHERE polname = 'tr_guardian_select';
-- Očekáváno: obsahuje guardian_can_access_student(student_id)
