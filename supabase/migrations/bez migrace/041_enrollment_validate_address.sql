-- =============================================================
-- Migrace 041 — enrollment_validate_address
-- IS Nilsson · ZŠ Vilekula Teplice
-- Navazuje na: 038 (ruian_okresy/ruian_obce), 039+040 (ruian_adresni_mista,
-- naimportováno 3 019 049 řádků), 037 (enrollment).
--
-- ÚČEL: nahrazuje původně plánované volání cizího API (ARES/ČÚZK) lokálním
-- SQL lookupem nad importovanými RÚIAN daty — viz pivot zaznamenaný dřív
-- v konverzaci (findAddressCandidates nevrací RÚIAN kódy, jen generická
-- Esri-kompatibilní pole).
--
-- PROČ JEDEN DOTAZ, NE DVOUKROKOVÁ RESOLUCE (obec -> pak adresa):
-- Ověřeno na reálných datech — napříč ČR existuje minimálně jedna trojice
-- stejnojmenných obcí ("Adamov", 3× v různých okresech). Kdyby se kód obce
-- resolvoval izolovaně před hledáním adresy, ambiguita obce by musela mít
-- vlastní řešení nezávislé na zbytku adresy. Místo toho se JOIN mezi
-- ruian_obce a ruian_adresni_mista dělá v jednom kroku s VŠEMI zadanými
-- kritérii (obec, ulice/část obce, číslo, PSČ) najednou — teprve počet
-- výsledných řádků rozhoduje o matched/ambiguous/not_found. Přirozeně to
-- řeší i případy, kdy je nejednoznačné číslo popisné se dvěma orientačními
-- vchody (např. "12" když existuje "12/1" i "12/2") — vrátí se to jako
-- ambiguous se seznamem kandidátů, ne jako chyba.
--
-- MATCHOVÁNÍ ULICE VS. ČÁSTI OBCE: pole "ulice" z formuláře se zkouší
-- nejdřív proti nazev_ulice, a pokud tam neuspěje, i proti
-- nazev_casti_obce — malé obce/vesnice běžně nemají ulice a lidé si jako
-- "ulici" logicky představí název místní části (viz ARCH-NOTES §4).
--
-- PSČ JE VOLITELNÝ TVRDÝ FILTR (ne fuzzy): pokud je zadané, MUSÍ sedět
-- přesně — žádná tolerance na překlep, ve shodě s principem "adresa je
-- tvrdý blok" z ARCH-NOTES §4. Pokud PSČ zadané není, filtr se přeskočí.
--
-- ČÍSLO (p_cislo): očekává se ve tvaru "150" nebo "150/2" (č.p./č.o.),
-- rozdělí se na cislo_domovni/cislo_orientacni podle lomítka.
-- =============================================================

CREATE OR REPLACE FUNCTION enrollment_validate_address(
  p_obec text,
  p_ulice text,      -- volitelné (může být i NULL/prázdné)
  p_cislo text,       -- "150" nebo "150/2"
  p_psc text          -- volitelné, ale silně doporučeno kvůli disambiguaci
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cislo_domovni text;
  v_cislo_orientacni text;
  v_count int;
  v_result jsonb;
  v_candidates jsonb;
BEGIN
  IF p_obec IS NULL OR trim(p_obec) = '' THEN
    RETURN jsonb_build_object('status', 'not_found', 'reason', 'obec_nezadana');
  END IF;
  IF p_cislo IS NULL OR trim(p_cislo) = '' THEN
    RETURN jsonb_build_object('status', 'not_found', 'reason', 'cislo_nezadano');
  END IF;

  IF p_cislo LIKE '%/%' THEN
    v_cislo_domovni := trim(split_part(p_cislo, '/', 1));
    v_cislo_orientacni := NULLIF(trim(split_part(p_cislo, '/', 2)), '');
  ELSE
    v_cislo_domovni := trim(p_cislo);
    v_cislo_orientacni := NULL;
  END IF;

  WITH candidates AS (
    SELECT
      a.ruian_kod,
      o.nazev_obce,
      o.kod_obce,
      o.kod_okresu,
      a.nazev_ulice,
      a.nazev_casti_obce,
      a.cislo_domovni,
      a.cislo_orientacni,
      a.psc,
      a.typ_so
    FROM ruian_adresni_mista a
    JOIN ruian_obce o ON o.kod_obce = a.kod_obce
    WHERE lower(immutable_unaccent(o.nazev_obce)) = lower(immutable_unaccent(trim(p_obec)))
      AND a.cislo_domovni = v_cislo_domovni
      AND (v_cislo_orientacni IS NULL OR a.cislo_orientacni = v_cislo_orientacni)
      AND (p_psc IS NULL OR trim(p_psc) = '' OR a.psc = trim(p_psc))
      AND (
        p_ulice IS NULL OR trim(p_ulice) = ''
        OR lower(immutable_unaccent(a.nazev_ulice)) = lower(immutable_unaccent(trim(p_ulice)))
        OR lower(immutable_unaccent(a.nazev_casti_obce)) = lower(immutable_unaccent(trim(p_ulice)))
      )
  )
  SELECT
    count(*),
    jsonb_agg(jsonb_build_object(
      'ruian_kod', ruian_kod,
      'obec_kod', kod_obce,
      'okres_kod', kod_okresu,
      'nazev_obce', nazev_obce,
      'nazev_ulice', nazev_ulice,
      'nazev_casti_obce', nazev_casti_obce,
      'cislo_domovni', cislo_domovni,
      'cislo_orientacni', cislo_orientacni,
      'typ_so', typ_so,
      'psc', psc
    ))
  INTO v_count, v_candidates
  FROM candidates;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('status', 'not_found');
  ELSIF v_count = 1 THEN
    RETURN (v_candidates -> 0) || jsonb_build_object('status', 'matched');
  ELSE
    RETURN jsonb_build_object('status', 'ambiguous', 'candidates', v_candidates);
  END IF;
END;
$$;

COMMENT ON FUNCTION enrollment_validate_address(text, text, text, text) IS
  'Lokální validace adresy proti importovaným RÚIAN datům (ruian_adresni_mista '
  '+ ruian_obce), nahrazuje volání cizího API. Vrací {status: matched|ambiguous|'
  'not_found, ...}. Jeden kombinovaný dotaz, ne dvoukroková resoluce obec->adresa '
  '— viz komentář v hlavičce migrace 041 (reálný případ víceznačnosti: 3 obce '
  'jménem "Adamov"). Voláno z frontendu enrollment formuláře při vyplňování '
  'adresy dítěte/zástupce; frontend na "ambiguous" nabídne výběr z candidates, '
  'na "not_found" zobrazí tvrdý blok (adresa musí být validovaná, ne volný text).';
