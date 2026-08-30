-- 097b_platby_backfill.sql
-- =============================================================================
-- Platby: částečné párování + dary — ČÁST B: backfill dat + swap CHECK.
-- PRD: PRD-platby-castecne-parovani-a-dary.md
--
-- PŘEDPOKLAD: 097a proběhla (sloupec donation_amount existuje).
-- POŘADÍ: 097a → 097b → 097c. Tady je jen plain SQL (žádné $$), takže bez potíží.
-- Trigger je zvlášť v 097c (pouštět SAMOSTATNĚ kvůli $$).
--
-- POZOR — DATOVÁ ZMĚNA: historické přeplatky (matched_amount > výše pohledávky,
-- typicky auto-spárované „platba > pohledávka") se překlasifikují na
-- matched_amount = výše pohledávky + donation_amount = přebytek (rozhodnutí R4).
-- =============================================================================

begin;

-- 1. Backfill historických přeplatků → matched (do výše pohledávky) + donation.
update public.payment_matches m
set donation_amount = round(m.matched_amount - o.amount, 2),
    matched_amount  = o.amount
from public.payment_obligations o
where m.obligation_id = o.id
  and m.matched_amount > o.amount;

-- 2. Uvolnit CHECK na match_status (přibývá 'partial', mizí 'manual_override').
alter table public.payment_transactions
  drop constraint if exists payment_transactions_match_status_check;

-- 3. Backfill odvozeného stavu transakcí: spotřebováno = Σ(matched + donation).
update public.payment_transactions t
set match_status = case
      when c.consumed >= t.amount then 'matched'
      when c.consumed > 0         then 'partial'
      else 'unmatched'
    end
from (
  select transaction_id, sum(matched_amount + donation_amount) as consumed
  from public.payment_matches
  group by transaction_id
) c
where c.transaction_id = t.id;

update public.payment_transactions t
set match_status = 'unmatched'
where match_status <> 'unmatched'
  and not exists (
    select 1 from public.payment_matches m where m.transaction_id = t.id
  );

-- 4. Nový CHECK na match_status.
alter table public.payment_transactions
  add constraint payment_transactions_match_status_check
  check (match_status = any (array['unmatched'::text, 'partial'::text, 'matched'::text]));

commit;
