-- =============================================================================
-- Migrace 171 — Tripartita: oprava časové zóny uložených termínů
--
-- Chyba: formulář termínu posílal datetime-local ('2026-11-10T14:00', bez zóny)
-- a server (Vercel, UTC) ho uložil jako 14:00 UTC místo 14:00 Europe/Prague.
-- Uložené časy jsou tedy o 1 h (SEČ) / 2 h (SELČ) posunuté oproti zadání.
-- Viditelné od v3.32.0, kdy se detail a CSV začaly zobrazovat v pražském čase.
--
-- Oprava: čas na hodinách (tak, jak je uložený v UTC) vyložit jako pražský.
--   (ts AT TIME ZONE 'UTC')            → timestamp bez zóny = zadané „14:00"
--   ... AT TIME ZONE 'Europe/Prague'   → timestamptz 14:00 pražského času
--
-- ⚠ SPUSTIT JEN JEDNOU a TĚSNĚ PŘED nasazením opravy kódu (merge PR).
--   Termíny založené už opraveným kódem by se posunuly podruhé. Mezi spuštěním
--   a nasazením nezakládat nové termíny.
-- =============================================================================

-- ── 1) Náhled (spustit samostatně PŘED úpravou) ──────────────────────────────
-- Sloupec „nyni" = jak se termín teď zobrazuje, „po_oprave" = jak se bude
-- zobrazovat. „po_oprave" má odpovídat času v popisku (label).
--
-- SELECT label,
--        to_char(starts_at AT TIME ZONE 'Europe/Prague', 'DD.MM. HH24:MI') AS nyni,
--        to_char(starts_at AT TIME ZONE 'UTC',           'DD.MM. HH24:MI') AS po_oprave,
--        created_at
--   FROM tripartita_slots
--  WHERE starts_at IS NOT NULL
--  ORDER BY starts_at;

-- ── 2) Oprava ────────────────────────────────────────────────────────────────

UPDATE tripartita_slots
   SET starts_at = (starts_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague',
       ends_at   = (ends_at   AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'
 WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL;

-- ── 3) Kontrola po úpravě (spustit samostatně) ───────────────────────────────
-- „cas" musí odpovídat času v popisku.
--
-- SELECT label,
--        to_char(starts_at AT TIME ZONE 'Europe/Prague', 'DD.MM. HH24:MI') AS cas
--   FROM tripartita_slots
--  WHERE starts_at IS NOT NULL
--  ORDER BY starts_at;
