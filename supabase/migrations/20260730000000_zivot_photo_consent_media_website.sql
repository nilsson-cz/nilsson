-- 20260730000000_zivot_photo_consent_media_website.sql
-- Oprava GDPR gatingu fotek zdi „Ze života školy".
--
-- PROBLÉM: web.photo_is_publishable četla public.students.photo_consent — mrtvý
-- denormalizovaný sloupec, který nic neplní (vždy false) → žádná otagovaná fotka
-- se nikdy nezveřejnila a admin ukazoval všechny žáky „bez souhlasu".
--
-- SPRÁVNÝ ZDROJ: modul GDPR souhlasů (public.consent_records + consent_definitions),
-- definice s kódem 'media_website' („Foto a audio/video – web školy"; 'media_instagram'
-- je zvlášť a pro web se NEpoužívá). Agregace přes zákonné zástupce je stejná jako
-- v public.get_student_consent_state: jakýkoli denied → denied; jinak aspoň jeden
-- granted → granted; jinak none. Publikovatelnost vyžaduje stav 'granted'.
--
-- MANTINELY: helper dostává explicitní granty (schéma web nemá default ACL);
-- vše v jedné transakci; po migraci spustit kontrolu níže (prostředí umí commit
-- po příkazech). photo_is_publishable přes CREATE OR REPLACE zachovává grantY.

begin;

-- 1) Helper: má žák platný souhlas s focením pro web školy?
create or replace function web.student_has_web_photo_consent(p_student_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'web'
as $$
  with reps as (
    select sgl.guardian_id
    from public.student_guardian_links sgl
    where sgl.student_id = p_student_id
      and sgl.je_zakonny_zastupce = true
      and (sgl.platnost_do is null or sgl.platnost_do >= current_date)
  ),
  latest as (
    select distinct on (cr.guardian_id) cr.guardian_id, cr.status
    from public.consent_records cr
    join public.consent_definitions d on d.id = cr.definition_id
    where cr.student_id = p_student_id
      and d.code = 'media_website'
      and cr.guardian_id in (select guardian_id from reps)
    order by cr.guardian_id, cr.decided_at desc
  )
  select coalesce(
    bool_or(status = 'granted') and not bool_or(status = 'denied'),
    false
  )
  from latest;
$$;

revoke all on function web.student_has_web_photo_consent(uuid) from public;
grant execute on function web.student_has_web_photo_consent(uuid) to anon, authenticated;

-- 2) Přepsat photo_is_publishable — jen kontrola souhlasu se mění na helper.
create or replace function web.photo_is_publishable(p_photo uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to 'public', 'web'
as $$
  select case
    when p.no_identifiable_person then true
    when not exists (select 1 from web.photo_tags t where t.photo_id = p.id) then false
    when exists (
      select 1 from web.photo_tags t
      where t.photo_id = p.id
        and not web.student_has_web_photo_consent(t.student_id)
    ) then false
    else true
  end
  from web.photos p where p.id = p_photo;
$$;

commit;

-- ---------------------------------------------------------------------
-- KONTROLA PO MIGRACI (spustit zvlášť, ověřit oba řádky = true):
--
--   select
--     to_regprocedure('web.student_has_web_photo_consent(uuid)') is not null as helper_exists,
--     has_function_privilege('anon', 'web.student_has_web_photo_consent(uuid)', 'execute') as anon_can_exec;
--
-- Funkční smoke test (dosaď id žáka, o němž víš, že MÁ web-foto souhlas → true):
--   select web.student_has_web_photo_consent('<student_uuid>');
-- ---------------------------------------------------------------------
