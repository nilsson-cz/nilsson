-- =============================================================================
--  094 — Karanténa osiřelých/superseded/zrušených tabulek (RENAME TO _attic_)
-- =============================================================================
--  Zdroj:  scripts/db-audit.sql blok #7 (studené tabulky), run 2026-08-24.
--          Detail a klasifikace: ARCH-NOTE-2026-08-24-db-hygiena-audit-*.md
--
--  ZLATÉ PRAVIDLO:  žádný DROP napřímo. Tohle je REVERZIBILNÍ karanténa.
--          Po 1–2 týdnech pozorování (nic je nehledá) → samostatná migrace s DROP.
--          Rollback kdykoli:  ALTER TABLE public._attic_x RENAME TO x;
--
--  Všech 6 tabulek má n_live_tup = 0 (prázdné) a ~0 reads → bezpečné.
--  Blok #1 auditu potvrdil: žádné příchozí FK, žádné view, žádná funkce je nečte.
--  Kódová kontrola: žádný .from()/dotaz v app/lib/components (hospitace = jen ikona).
-- =============================================================================

-- Legacy / superseded ---------------------------------------------------------
alter table public.hospitace       rename to _attic_hospitace;       -- nahrazeno rozvrh_blok_priznak + tridnice_priznak_typ (migrace 066)
alter table public.student_notes   rename to _attic_student_notes;   -- vypadlo z TRD v2.0 → v2.1
alter table public.lunch_allergens rename to _attic_lunch_allergens; -- drift bez migrace/kódu; alergeny 1–14 řeší app hardcoded

-- Modul hromadné komunikace — ZRUŠEN (rozhodnutí 2026-08-24) -------------------
--   FK chain:  comm_campaign_recipients.campaign_id → comm_campaigns
--              comm_log.campaign_id                 → comm_campaigns
--   RENAME pořadí je jedno (constraints jdou s tabulkou). Při budoucím DROP ale
--   napřed děti (recipients, log), pak rodič (campaigns).
alter table public.comm_campaign_recipients rename to _attic_comm_campaign_recipients;
alter table public.comm_log                 rename to _attic_comm_log;
alter table public.comm_campaigns           rename to _attic_comm_campaigns;

-- =============================================================================
--  PO SPUŠTĚNÍ:
--   • NEregenerovat db:types hned — attic názvy by zašuměly types/*.ts.
--     Typy sjednotit až po finálním DROP (jedním regenem).
--   • Zapsat do sprintu (hygiena-runbook.md) datum karantény + kdy DROP.
-- =============================================================================
