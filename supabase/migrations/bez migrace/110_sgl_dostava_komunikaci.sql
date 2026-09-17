-- 110_sgl_dostava_komunikaci.sql
-- =============================================================================
-- Příjemci notifikací nezávisle na roli: opt-in příznak „dostává komunikaci".
--
-- PROBLÉM: Notifikace (Platby i Bulletin) posílají jen zákonným zástupcům
-- (student_guardian_links.je_zakonny_zastupce = true). Constraint chk_sgl_role_zz
-- (migrace 001, TRD addendum 10.3) ale zakazuje, aby role 'sverena_pece' a
-- 'kontaktni_osoba' byly zákonnými zástupci — což právně odpovídá (svěření do
-- péče ani kontaktní osoba z nikoho nedělá zákonného zástupce). Prarodiče se
-- svěřenou péčí / kontaktní osoby tak nešlo udělat příjemci pouhým přepnutím
-- flagu — constraint to (správně) zablokoval.
--
-- ŘEŠENÍ: samostatný příznak dostava_komunikaci na vazbě, NEZÁVISLÝ na roli i na
-- je_zakonny_zastupce. Oba resolvery (Platby: app/actions/payments.ts;
-- Bulletin: RPC bulletin_resolve_recipients) nově posílají komukoli, kdo je
-- zákonný zástupce NEBO má dostava_komunikaci = true. Role a constraint zůstávají
-- beze změny — úřední výstupy dál vidí pravdivé zákonné zástupce.
--
-- Default false → žádná změna chování u stávajících dat; příznak se zapíná ručně
-- jen tam, kde má někdo mimo zákonné zástupce dostávat komunikaci.
--
-- >>> Krok 2 (create or replace function) má dollar-quote tělo. Když editor hlásí
--     problém s víc příkazy najednou, spusť kroky 1/2/3 samostatně. <<<
-- =============================================================================

-- --- Krok 1: sloupec --------------------------------------------------------
alter table public.student_guardian_links
  add column if not exists dostava_komunikaci boolean not null default false;

comment on column public.student_guardian_links.dostava_komunikaci is
  'Opt-in: tato osoba má dostávat školní komunikaci (Platby, Bulletin) i když '
  'není zákonný zástupce (např. prarodič se svěřenou péčí, kontaktní osoba). '
  'Nezávislé na roli i je_zakonny_zastupce. Resolvery: OR je_zakonny_zastupce.';

-- --- Krok 2: Bulletin resolver (tělo z migrace 098 + OR na nový příznak) -----
create or replace function public.bulletin_resolve_recipients(
  p_group_ids             uuid[],
  p_excluded_guardian_ids uuid[],
  p_school_year           text        -- ponecháno kvůli signatuře, ignorováno
)
returns table(id uuid, first_name text, last_name text, email text)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if current_staff_id() is null then
    raise exception 'bulletin_resolve_recipients: pouze zaměstnanec';
  end if;

  return query
    select distinct on (g.id)
        g.id, g.first_name, g.last_name, g.email
    from group_memberships gm
    join student_guardian_links sgl
        on  sgl.student_id = gm.student_id
        and (sgl.je_zakonny_zastupce = true or sgl.dostava_komunikaci = true)
        and (sgl.platnost_do is null or sgl.platnost_do >= current_date)
    join guardians g on g.id = sgl.guardian_id
    where gm.group_id = any(p_group_ids)
      and (gm.valid_to is null or gm.valid_to >= current_date)
      and g.id != all(p_excluded_guardian_ids)
    order by g.id;
end;
$fn$;

-- --- Krok 3: zapnutí příznaku pro konkrétní dítě (0ef8bd26… – prarodiče) -----
-- Babička Pastorová Jitka (svěřená péče) + dědeček Pastor René (kontaktní osoba).
-- Očekávaný výstup: 2 řádky, dostava_komunikaci = true.
update public.student_guardian_links
set dostava_komunikaci = true
where student_id = '0ef8bd26-3b46-47f0-be29-b223c830bcdf'
  and guardian_id in (
    '5700b162-1a64-4a34-8a00-ed059f69af1a',  -- Pastorová Jitka (babička)
    'f8434e09-53f4-4aeb-8ccd-a92c2bcecfd0'   -- Pastor René (dědeček)
  )
returning guardian_id, dostava_komunikaci;
