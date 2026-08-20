-- =============================================================================
--  Nilsson — DB hygiena audit
-- =============================================================================
--  Účel:  najít sirotky, duplicity, osiřelá data, drift a bezpečnostní mezery
--         v živé databázi. Read-only — NIC nemění.
--
--  KDE spouštět:  Supabase Studio → SQL Editor, POD ADMINEM (service role).
--                 Pod anon/authenticated klíčem RLS maskuje počty (count→0),
--                 takže výsledky NEJSOU pravdivé. Admin RLS obchází.
--
--  KDY spouštět:  čtvrtletní hygienický sprint + před větším releasem.
--                 Postup a interpretace: scripts/hygiena-runbook.md
--
--  TIMEOUT?  Spouštěj po blocích 1–9 (ne celý soubor najednou) — SQL editor má
--            per-běh limit. Nejtěžší je #1 (a #6); ostatní jsou lehké. Volitelně
--            v session navyš:  SET statement_timeout = '300s';
--
--  ZLATÉ PRAVIDLO:  nikdy DROP napřímo. Karanténa → 1–2 týdny pozorovat → DROP.
--       ALTER TABLE public.x RENAME TO _attic_x;   -- reverzibilní jedním příkazem
--
--  Schémata:  auditujeme 'public' i 'web' (web není v migracích → největší drift).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) DETEKTOR „DUCHA" — tabulka bez příchozího FK, bez view, bez funkce
--    (přesně tímto by se odhalil bývalý orphan school_calendar_holidays)
--    Nízké approx_rows + samé nuly vpravo = nejsilnější kandidát na karanténu.
-- -----------------------------------------------------------------------------
--    PERF: drahý regex přes zdroje funkcí/view počítáme JEN pro tabulky bez
--    příchozího FK (kandidáty) a jen ve schématech public/web (ne built-iny)
--    — jinak O(tabulky × všechny funkce v DB) → timeout.
with t as (
  select c.oid, n.nspname sch, c.relname tbl, c.reltuples::bigint approx_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public','web')
),
fk_in as (   -- tabulky, na které ukazuje aspoň jeden cizí klíč
  select distinct confrelid oid from pg_constraint where contype = 'f'
),
cand as (    -- kandidáti na ducha = bez příchozího FK (jen pro ně počítáme regex)
  select t.* from t
  where not exists (select 1 from fk_in where fk_in.oid = t.oid)
),
refs as (    -- výskyt názvu tabulky ve zdrojích funkcí a v definicích view (public/web)
  select c.oid,
    (select count(*) from pg_proc p
       join pg_namespace pn on pn.oid = p.pronamespace
       where pn.nspname in ('public','web') and p.prosrc ~* ('\m' || c.tbl || '\M')) in_funcs,
    (select count(*) from pg_views v
       where v.schemaname in ('public','web') and v.definition ~* ('\m' || c.tbl || '\M')) in_views
  from cand c
)
select c.sch, c.tbl, c.approx_rows,
       0 as inbound_fks, refs.in_views, refs.in_funcs
from cand c
join refs on refs.oid = c.oid
where refs.in_views = 0 and refs.in_funcs = 0
order by c.approx_rows;
--  ➜ Kandidáty křížově ověř greppem v kódu:  grep -rl "<tbl>" app lib components


-- -----------------------------------------------------------------------------
-- 2) „MRTVÝ ZÁMEK" — RLS zapnuté, ale 0 politik (= deny-all)
--    Buď bezpečnostní past, nebo příznak polozapomenuté tabulky.
-- -----------------------------------------------------------------------------
select n.nspname, c.relname,
       c.relrowsecurity      as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       count(p.polname)      as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where c.relkind = 'r' and n.nspname in ('public','web')
group by 1, 2, 3, 4
having c.relrowsecurity and count(p.polname) = 0;


-- -----------------------------------------------------------------------------
-- 2b) BEZPEČNOSTNÍ DÍRA — tabulka BEZ RLS (v public/web by měla mít skoro každá)
-- -----------------------------------------------------------------------------
select n.nspname, c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public','web')
  and not c.relrowsecurity
order by 1, 2;


-- -----------------------------------------------------------------------------
-- 3) FK-LIKE SLOUPCE BEZ FK CONSTRAINTU — kde se tiše líhnou osiřelá data
--    (inserty přes `(supabase as any)` obcházejí typy i FK)
--    ➜ Zvaž doplnění FOREIGN KEY ... ON DELETE — orphan se změní v tvrdou chybu.
-- -----------------------------------------------------------------------------
select c.table_schema, c.table_name, c.column_name
from information_schema.columns c
where c.table_schema in ('public','web')
  and c.column_name like '%\_id' escape '\'
  and c.column_name <> 'id'
  and not exists (
    select 1
    from information_schema.key_column_usage k
    join information_schema.table_constraints tc
      on tc.constraint_name   = k.constraint_name
     and tc.constraint_schema = k.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and k.table_schema = c.table_schema
      and k.table_name   = c.table_name
      and k.column_name  = c.column_name)
order by 1, 2, 3;


-- -----------------------------------------------------------------------------
-- 4) OSIŘELÉ ŘÁDKY — děti ukazující na neexistujícího rodiče
--    Nejčastěji mazané entity = students / guardians. Uprav názvy FK sloupců
--    dle reálného schématu (viz types/database.ts). Vrací počty > 0 = problém.
-- -----------------------------------------------------------------------------
select 'group_memberships → student' as vazba, count(*) as orphans
  from group_memberships gm
  left join students s on s.id = gm.student_id
  where gm.student_id is not null and s.id is null
union all
select 'attendance_records → student', count(*)
  from attendance_records a
  left join students s on s.id = a.student_id
  where a.student_id is not null and s.id is null
union all
select 'student_guardian_links → guardian', count(*)
  from student_guardian_links l
  left join guardians g on g.id = l.guardian_id
  where l.guardian_id is not null and g.id is null
union all
select 'student_guardian_links → student', count(*)
  from student_guardian_links l
  left join students s on s.id = l.student_id
  where l.student_id is not null and s.id is null
union all
select 'payment_obligations → student', count(*)
  from payment_obligations po
  left join students s on s.id = po.student_id
  where po.student_id is not null and s.id is null;
--  ŠABLONA pro další vazby:
--    select count(*) from <dite> ch
--    left join <rodic> p on p.id = ch.<rodic>_id
--    where ch.<rodic>_id is not null and p.id is null;


-- -----------------------------------------------------------------------------
-- 5) NEVYUŽITÉ INDEXY — bloat + zpomalený zápis (idx_scan = 0 od reset statistik)
-- -----------------------------------------------------------------------------
select schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes
where idx_scan = 0
  and schemaname in ('public','web')
  and indexrelname not like '%_pkey'
order by pg_relation_size(indexrelid) desc;


-- -----------------------------------------------------------------------------
-- 6) TÉMĚŘ DUPLICITNÍ TABULKY — velký překryv sloupců
--    (odhalí páry typu bozp_attendance vs bozp_zaznamy apod.)
-- -----------------------------------------------------------------------------
with cols as (
  select table_name, array_agg(column_name order by column_name) c
  from information_schema.columns
  where table_schema = 'public'
  group by 1
)
select a.table_name, b.table_name, s.shared,
       cardinality(a.c) a_cols, cardinality(b.c) b_cols
from cols a
join cols b on a.table_name < b.table_name
cross join lateral (   -- překryv počítáme jednou (ne 2× jako dřív)
  select cardinality(array(select unnest(a.c) intersect select unnest(b.c))) as shared
) s
where s.shared >= 5
order by s.shared desc;


-- -----------------------------------------------------------------------------
-- 7) „STUDENÉ" TABULKY — od resetu statistik nikdo nečetl ani nezapsal
--    reads = 0 u tabulky, která tu je měsíce → kandidát na karanténu.
--    (Pozn.: statistiky se nulují restartem/ANALYZE — čti relativně, ne absolutně.)
-- -----------------------------------------------------------------------------
select schemaname, relname, n_live_tup,
       seq_scan, idx_scan,
       coalesce(seq_scan, 0) + coalesce(idx_scan, 0) as reads,
       n_tup_ins, n_tup_upd, n_tup_del,
       last_autovacuum
from pg_stat_user_tables
where schemaname in ('public','web')
order by reads asc, n_live_tup desc;


-- -----------------------------------------------------------------------------
-- 8) DRIFT — soupis všech tabulek živé DB pro porovnání s types/database.ts
--    Lepší varianta: regenerovat typy z živé DB a udělat `git diff` (viz runbook).
-- -----------------------------------------------------------------------------
select table_schema, table_name
from information_schema.tables
where table_schema in ('public','web')
  and table_type = 'BASE TABLE'
order by 1, 2;


-- -----------------------------------------------------------------------------
-- 9) BEZPEČNOST: SECURITY DEFINER funkce spustitelné rolí `anon`
--    SECDEF běží pod ownerem → OBCHÁZÍ RLS. Guardless SECDEF + anon = kdokoli
--    (i nepřihlášený) čte/mění data. `REVOKE FROM PUBLIC` NESTAČÍ — Supabase
--    grantuje anon/authenticated EXECUTE přímo. Detail: scripts/secdef-audit.sql.
--
--    riziko = VYSOKÉ  → anon + bez guardu (heuristika) → prověřit tělo, hardenit
--             střední → anon, ale s guardem (obv. fail-closed) → hygiena, nižší prio
--    POZOR — NEREVOKOVAT od anon RLS predikáty (rozbije RLS):
--      has_role, enrollment_is_owner_on_application + identity primitivy
--      (is_guardian, is_director(_or_vp), is_vp, current_staff_id/role,
--       current_guardian_id, can_read_student, can_read_guardian,
--       staff_can_access_student, guardian_can_access_student).
--    Historie: dávka 050 + hardening 077/086/087. Funkce přidané po dávce mají
--    tendenci propadat (recreate resetuje grant) → tahle kontrola to chytí.
-- -----------------------------------------------------------------------------
with secdef as (
  select
    p.oid,
    p.oid::regprocedure as fn,
    has_function_privilege('anon',          p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
    (pg_get_functiondef(p.oid) ~* '(is_director|is_director_or_vp|is_guardian|is_vp|current_staff_id|current_staff_role|guardian_can_access_student|can_read_student|staff_can_access_student|current_guardian_id|auth\.uid|raise exception)') as ma_guard
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
)
select fn, anon_exec, auth_exec, ma_guard,
       case when anon_exec and not ma_guard then 'VYSOKÉ — anon + bez guardu'
            when anon_exec and ma_guard     then 'střední — anon, ale s guardem'
            else 'ok' end as riziko
from secdef
where anon_exec                       -- jen problematické; smaž řádek pro plný přehled
order by (anon_exec and not ma_guard) desc, fn;


-- -----------------------------------------------------------------------------
-- 9b) GENERÁTOR REVOKE příkazů pro anon-spustitelné SECDEF funkce.
--     NEspouštět naslepo — projít výstup, VYNECHAT RLS predikáty ze seznamu v #9,
--     zkopírovat zbytek a spustit. (Guardless funkce navíc zvaž doplnit interní
--     guard, ne jen revoke — samotný revoke anon nechrání před `authenticated`.)
-- -----------------------------------------------------------------------------
select format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon;', p.oid::regprocedure) as revoke_stmt
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.oid::regprocedure::text;

-- =============================================================================
--  Konec auditu. Nálezy zapiš do sprintu dle scripts/hygiena-runbook.md.
-- =============================================================================
