-- =============================================================================
-- Migrace 134a — číselník způsobu plnění PŠD podle MŠMT RASD (enum + komentáře)
-- Datum: 2026-09-29
-- Pokračuje: 134b_zpusob_psd_24_zahranici.sql (data) — pustit AŽ PO této migraci,
--   samostatně. Nové hodnoty enumu nejdou použít ve stejné transakci, ve které
--   vznikly (ALTER TYPE ... ADD VALUE).
--
-- Proč: enum zpusob_plneni_psd (init.sql) měl vlastní výklad kódů, který se
--   s MŠMT neshodoval (30 = „§ 38", 40 = „zahraničí", 50 = „§ 42"). Oficiální
--   číselník RASD (stistko.uiv.cz/katalog/cslnk.asp?idc=RASD, ověřeno 2026-09-29):
--     11  školní docházka ve škole zapsané ve školském rejstříku
--     12  souběžné vzdělávání v ZŠ v rámci střídavé péče
--     15  plnění PŠD podle § 50 odst. 3 ŠZ
--     21  § 38 odst. 1 písm. a) — zahraniční škola mimo ČR
--     22  § 38 odst. 1 písm. b) — škola při diplomatické misi / konzulátu ČR
--     23  § 38 odst. 1 písm. c) — zahraniční škola na území ČR
--     24  § 38 odst. 2 — individuální výuka v zahraničí
--     25  § 38 odst. 1 písm. d) — evropská škola
--     30  individuální vzdělávání podle § 41 ŠZ
--     40  § 42 ŠZ — ZRUŠEN k 31. 8. 2019
--     50  v RASD neexistuje
--   Kód se posílá do matriky 1:1 (lib/msmt-xml.ts, položka ZPUSOB).
--
-- Co dělá:
--   1) doplní do enumu platné kódy 12, 15, 21–25,
--   2) zakáže 40 a 50 v student_education_mode (hodnoty z enumu odebrat nejde;
--      pokud je někdo používá, migrace skončí chybou a nic nezmění),
--   3) opraví komentáře typu a sloupce students.education_mode.
--
-- Sdílený výklad v kódu: lib/zpusob-psd.ts.
-- SQL editor dashboardu: znak dolaru jen ve značkách těla, žádné rovné dvojité
--   uvozovky. Spustit RUČNĚ v Supabase (viz [[migracni-workflow]]).
-- Po spuštění: npm run db:types
-- =============================================================================

ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '12' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '15' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '21' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '22' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '23' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '24' BEFORE '30';
ALTER TYPE zpusob_plneni_psd ADD VALUE IF NOT EXISTS '25' BEFORE '30';

ALTER TABLE student_education_mode
  DROP CONSTRAINT IF EXISTS chk_sem_zpusob_rasd;
ALTER TABLE student_education_mode
  ADD CONSTRAINT chk_sem_zpusob_rasd
  CHECK (zpusob::text NOT IN ('40', '50'));

COMMENT ON TYPE zpusob_plneni_psd IS
  'Způsob plnění PŠD = kód MŠMT číselníku RASD (položka ZPUSOB matriky, posílá se 1:1). '
  '11 docházka do školy v rejstříku; 12 souběžné vzdělávání (střídavá péče); '
  '15 § 50 odst. 3; 21–25 plnění podle § 38 (21 zahraniční škola mimo ČR, '
  '22 škola při misi ČR, 23 zahraniční škola v ČR, 24 individuální výuka v zahraničí, '
  '25 evropská škola); 30 individuální vzdělávání § 41. '
  '40 a 50 jsou pozůstatek (40 zrušen MŠMT k 31. 8. 2019, 50 neexistuje) — zakázány CHECKem. '
  'Výklad v kódu: lib/zpusob-psd.ts. Migrace 134a.';

COMMENT ON COLUMN students.education_mode IS
  'Rychlý indikátor pro UI a výkaz pro KÚ (snapshot, bez historie): '
  'standardni = docházka do školy § 36 (RASD 11/12/15), '
  'jiny_zpusob = plnění PŠD podle § 38 (RASD 21–25), '
  'domaci = individuální vzdělávání § 41 (RASD 30). '
  'Závazná historie je v student_education_mode. Migrace 134a.';

-- -----------------------------------------------------------------------------
-- Kontrola po spuštění:
--   SELECT unnest(enum_range(NULL::zpusob_plneni_psd));
--     → 11, 12, 15, 21, 22, 23, 24, 25, 30, 40, 50
-- -----------------------------------------------------------------------------
