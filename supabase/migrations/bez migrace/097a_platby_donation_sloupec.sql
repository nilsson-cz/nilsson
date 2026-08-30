-- 097a_platby_donation_sloupec.sql
-- =============================================================================
-- Platby: částečné párování + dary — ČÁST A: nový sloupec donation_amount.
-- PRD: PRD-platby-castecne-parovani-a-dary.md
--
-- POŘADÍ: spusť NEJPRVE tento soubor (097a), nech commitnout, TEPRVE PAK 097b.
-- Důvod dělení: Supabase SQL editor posílá skript jako jeden dotaz a parsuje ho
-- celý dopředu → backfill v 097b se nesmí odkazovat na sloupec přidávaný ve
-- stejném batchi. Když se sloupec přidá (a commitne) samostatně tady, 097b už
-- ho na top-levelu vidí a nepotřebuje žádné DO bloky.
-- =============================================================================

begin;

alter table public.payment_matches
  add column if not exists donation_amount numeric(10,2) not null default 0;

alter table public.payment_matches
  drop constraint if exists check_donation_amount_nonneg;
alter table public.payment_matches
  add constraint check_donation_amount_nonneg check (donation_amount >= 0);

commit;
