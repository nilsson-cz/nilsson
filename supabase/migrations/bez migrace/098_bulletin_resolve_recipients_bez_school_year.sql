-- 098_bulletin_resolve_recipients_bez_school_year.sql
-- =============================================================================
-- Bulletin: oprava „Příspěvek nemá žádné příjemce" u skupin z jiného roku.
--
-- PŘÍČINA: picker skupin v přechodném období nabízí skupiny z OBOU aktivních
-- roků (ACTIVE_SCHOOL_YEARS — např. loňská „I." vedle letošních Beta/Gamma), ale
-- bulletin_resolve_recipients natvrdo filtroval gm.school_year = p_school_year
-- (= CURRENT_SCHOOL_YEAR = '2026/2027'). Když uživatel vybral loňskou skupinu,
-- resolver v ní hledal letošní členy → 0 příjemců → post vznikl bez příjemců
-- (materializace je neblokující) → odeslání hlásí „nemá žádné příjemce".
--
-- OPRAVA: odstranit filtr school_year. group_id už rok jednoznačně určuje (každá
-- skupina patří jednomu školnímu roku), takže filtr je zbytečný a v přechodném
-- období rozbíjí výběr skupiny z předchozího roku. Parametr p_school_year se
-- v signatuře ponechává (volá ho lib/bulletin/recipients.ts), ale ignoruje se.
--
-- Zbytek těla beze změny: guard „jen zaměstnanec", je_zakonny_zastupce, valid_to
-- (bez valid_from — migrace 093), != ALL (korektní vyloučení).
--
-- >>> POUŠTĚJ SAMOSTATNĚ <<< (dollar-quote tělo funkce).
-- =============================================================================

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
        on  sgl.student_id          = gm.student_id
        and sgl.je_zakonny_zastupce = true
        and (sgl.platnost_do is null or sgl.platnost_do >= current_date)
    join guardians g on g.id = sgl.guardian_id
    where gm.group_id = any(p_group_ids)
      and (gm.valid_to is null or gm.valid_to >= current_date)
      and g.id != all(p_excluded_guardian_ids)
    order by g.id;
end;
$fn$;
