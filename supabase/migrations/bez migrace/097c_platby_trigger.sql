-- 097c_platby_trigger.sql
-- =============================================================================
-- Platby: částečné párování + dary — ČÁST C: invariantní trigger.
-- PRD: PRD-platby-castecne-parovani-a-dary.md
--
-- PŘEDPOKLAD: 097a + 097b už proběhly.
-- >>> POUŠTĚJ TENTO SOUBOR SAMOSTATNĚ <<< (nic jiného v SQL editoru), ať se
-- dollar-quote tělo funkce ($$ … $$) nezakuckne s okolními příkazy.
--
-- Trigger po každé změně payment_matches: drží invarianty (nejde přealokovat
-- pohledávku ani přečerpat platbu) a cachuje odvozený match_status transakce
-- {unmatched, partial, matched}. Zámky přes PERFORM … FOR UPDATE (serializace
-- souběhu), hodnoty čte samostatným SELECT … INTO.
-- =============================================================================

create or replace function public.payments_matches_recount_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_tx uuid;
  v_ob uuid;
  v_tx_amount   numeric(10,2);
  v_ob_amount   numeric(10,2);
  v_tx_consumed numeric(10,2);
  v_ob_matched  numeric(10,2);
  v_status text;
begin
  v_tx := coalesce(new.transaction_id, old.transaction_id);
  v_ob := coalesce(new.obligation_id,  old.obligation_id);

  -- Zámek rodičovských řádků ve stálém pořadí (pohledávka → transakce),
  -- ať se přealokování nedá proklikat souběhem.
  perform 1 from public.payment_obligations  where id = v_ob for update;
  perform 1 from public.payment_transactions where id = v_tx for update;

  select amount into v_ob_amount from public.payment_obligations  where id = v_ob;
  select amount into v_tx_amount from public.payment_transactions where id = v_tx;

  -- Součty po provedené změně (AFTER trigger → řádek už je zapsán).
  select coalesce(sum(matched_amount), 0)
    into v_ob_matched
    from public.payment_matches where obligation_id = v_ob;

  select coalesce(sum(matched_amount + donation_amount), 0)
    into v_tx_consumed
    from public.payment_matches where transaction_id = v_tx;

  -- I1: pohledávku nejde přealokovat (dar se do dluhu nepočítá).
  if v_ob_amount is not null and v_ob_matched > v_ob_amount then
    raise exception 'payments_guard: pohledavka % prealokovana (sparovano % > pohledavka %)',
      v_ob, v_ob_matched, v_ob_amount;
  end if;

  -- I2: transakci nejde přečerpat (dluh + dar ≤ výše platby).
  if v_tx_amount is not null and v_tx_consumed > v_tx_amount then
    raise exception 'payments_guard: transakce % precerpana (spotrebovano % > platba %)',
      v_tx, v_tx_consumed, v_tx_amount;
  end if;

  -- Cache odvozeného stavu transakce.
  if v_tx_amount is not null then
    if v_tx_consumed >= v_tx_amount then
      v_status := 'matched';
    elsif v_tx_consumed > 0 then
      v_status := 'partial';
    else
      v_status := 'unmatched';
    end if;

    update public.payment_transactions
      set match_status = v_status
      where id = v_tx and match_status is distinct from v_status;
  end if;

  return null;
end;
$func$;

drop trigger if exists trg_payment_matches_recount_guard on public.payment_matches;

create trigger trg_payment_matches_recount_guard
  after insert or update or delete on public.payment_matches
  for each row execute function public.payments_matches_recount_guard();
