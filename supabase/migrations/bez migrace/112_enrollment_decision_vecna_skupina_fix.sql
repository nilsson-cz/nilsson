-- 112_enrollment_decision_vecna_skupina_fix.sql
--
-- Fix: enrollment_record_decision() padalo při potvrzení rozhodnutí s chybou
--   "column v.vecna_skupina_id does not exist".
--
-- Příčina: v INSERTu do `dokumenty` se z aliasu `v` (= tabulka vecne_skupiny)
-- vybíral neexistující sloupec `v.vecna_skupina_id`. Tabulka vecne_skupiny má
-- primární klíč `id` (viz 036_essl.sql); sloupec `vecna_skupina_id` je naopak
-- v cílové tabulce `dokumenty` jako FK na vecne_skupiny(id). Správně je `v.id`.
--
-- Sesterská funkce enrollment_essl_open_spis to dělá správně (SELECT id ...).
-- Oprava je jediný řádek; zbytek těla funkce je beze změny vůči 037.

CREATE OR REPLACE FUNCTION enrollment_record_decision(
  p_application_id      uuid,
  p_rozhodnuti          enrollment_rozhodnuti,
  p_duvod               text DEFAULT NULL,
  p_cilovy_school_year  text DEFAULT NULL,
  p_datum_nastupu       date DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app          enrollment_applications%ROWTYPE;
  v_dokument_id  uuid;
  v_decision_id  bigint;
  v_zpusob_vyrizeni zpusob_vyrizeni;
BEGIN
  IF NOT has_role('director') THEN
    RAISE EXCEPTION 'enrollment_record_decision: pouze ředitel smí rozhodovat';
  END IF;

  SELECT * INTO v_app FROM enrollment_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment_record_decision: žádost % nenalezena', p_application_id;
  END IF;

  IF v_app.spis_id IS NULL THEN
    RAISE EXCEPTION 'enrollment_record_decision: žádost nemá eSSL spis — zavolej nejdřív enrollment_essl_open_spis';
  END IF;

  v_zpusob_vyrizeni := CASE
    WHEN p_rozhodnuti IN ('stornovano_rodicem', 'nedostavili_se') THEN 'vzato_na_vedomi'
    ELSE 'rozhodnuti_vydano'
  END;

  -- Dokument "rozhodnutí" — vlastní dokument školy, ne přijatý
  INSERT INTO dokumenty (vecna_skupina_id, smer, predmet, stav, zpusob_vyrizeni, datum_vyrizeni)
  SELECT
    v.id, 'vlastni',
    format('Rozhodnutí — %s — %s %s', p_rozhodnuti::text, v_app.dite_jmeno, v_app.dite_prijmeni),
    'vyrizeno', v_zpusob_vyrizeni, CURRENT_DATE
  FROM spisy s
  JOIN vecne_skupiny v ON v.spis_znak = CASE v_app.typ WHEN 'zapis' THEN '3.1' ELSE '3.2' END
  WHERE s.id = v_app.spis_id
  RETURNING id INTO v_dokument_id;

  INSERT INTO dokument_spis (dokument_id, spis_id) VALUES (v_dokument_id, v_app.spis_id);

  PERFORM essl_log('dokument_vyrizeno', v_dokument_id, v_app.spis_id, NULL,
    jsonb_build_object('application_id', p_application_id, 'rozhodnuti', p_rozhodnuti));

  INSERT INTO enrollment_decisions (
    application_id, rozhodnuti, duvod, cilovy_school_year, datum_nastupu,
    rozhodl_user_id, dokument_id
  ) VALUES (
    p_application_id, p_rozhodnuti, p_duvod, p_cilovy_school_year, p_datum_nastupu,
    auth.uid(), v_dokument_id
  )
  RETURNING id INTO v_decision_id;

  -- trg_enrollment_sync_stav (viz výše) aktualizuje enrollment_applications.stav

  IF p_rozhodnuti IN ('prijat', 'autoremedura_prijat') THEN
    PERFORM enrollment_migrate_to_student(p_application_id, v_decision_id);
  END IF;

  RETURN v_decision_id;
END;
$fn$;
