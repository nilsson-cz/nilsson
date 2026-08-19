// scripts/import_ds_log.ts
// Import historického DS logu (sheet 'datovka') do tabulky dokumenty
// Spustit: npx ts-node scripts/import_ds_log.ts
//
// Předpoklady:
//   - Migrace 036 nasazena
//   - Seed vecne_skupiny_l3 nasazen
//   - Seed jmenny_rejstrik (z migrace 036) nasazen
//   - .env.local obsahuje SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Spustit:
//   $env:SUPABASE_URL="https://xxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."; npx ts-node scripts/import_ds_log.ts

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Chybí env proměnné. Nastav před spuštěním:')
  console.error('  $env:SUPABASE_URL="https://xxx.supabase.co"')
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY)

// ============================================================
// ZDROJOVÁ DATA (zkopírováno ze sheetu 'datovka')
// Typ: 'Odeslaná' | 'Přijatá' | 'odeslaná' | 'přijatá'
// ============================================================

interface DsRadek {
  id: number
  typ: string
  adresat: string
  predmet: string
  datum: string  // 'DD.MM.YYYY' nebo 'YYYY-MM-DD HH:mm'
}

const DS_LOG: DsRadek[] = [
  // --- starší záznamy (formát DD.MM.YYYY) ---
  { id: 1650537270, typ: 'Odeslaná',  adresat: 'Základní škola Proboštov',                                              predmet: 'Oznámení o přestupu žáka žádost a předání katalogového listu',                          datum: '16.02.2026' },
  { id: 1648072849, typ: 'Odeslaná',  adresat: 'Krajský soud v Ústí nad Labem',                                         predmet: 'Návrh na zápis údajů do evidence skutečných majitelů',                                    datum: '10.02.2026' },
  { id: 1643641327, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Hlášení výkonů 01/2026',                                                                  datum: '02.02.2026' },
  { id: 1641552078, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Smlouva č. 26_SML000784_SOPD_SMT',                                                    datum: '28.01.2026' },
  { id: 1641552076, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Dodatky ke smlouvám školní stravování Vilekula',                                       datum: '28.01.2026' },
  { id: 1633219968, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Výkaz P 1-04',                                                                            datum: '14.01.2026' },
  { id: 1632234450, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o zvýšenou dotaci',                                                                datum: '12.01.2026' },
  { id: 1632234683, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o základní dotaci',                                                                datum: '12.01.2026' },
  { id: 1627822569, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o zvýšenou dotaci',                                                                datum: '03.01.2026' },
  { id: 1627815494, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o základní dotaci',                                                                datum: '03.01.2026' },
  { id: 1626030516, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Hlášení výkonů 12/2025',                                                                  datum: '29.12.2025' },
  { id: 1622948914, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Dodatek ke smlouvě o poskytnutí dotace na ŠR 25/26 školní stravování',               datum: '17.12.2025' },
  { id: 1615872661, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o uzavření dodatku ke smlouvě na školní rok 2025/2026',                           datum: '05.12.2025' },
  { id: 1613104924, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Hlášení výkonů 11/2025',                                                                  datum: '01.12.2025' },
  { id: 1591201123, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Výkaz R44-99',                                                                            datum: '14.10.2025' },
  { id: 1591199844, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Výkaz R43',                                                                               datum: '14.10.2025' },
  { id: 1591200880, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Výkaz R13',                                                                               datum: '14.10.2025' },
  { id: 1591201454, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Výkaz P 1-04',                                                                            datum: '14.10.2025' },
  { id: 1584842774, typ: 'Odeslaná',  adresat: 'Zdravotní pojišťovna ministerstva vnitra České republiky',               predmet: 'Přihláška zaměstnavatele',                                                                datum: '30.09.2025' },
  { id: 1579681237, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Smlouva 25/SML002878-6450/SOPD/SMT',                                                  datum: '18.09.2025' },
  { id: 1579049915, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Smlouva 25/SML002878-6450/SOPD/SMT',                                                  datum: '17.09.2025' },
  { id: 1575740760, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'RE:Smlouva 25/SML002878-6450/SOPD/SMT',                                                  datum: '10.09.2025' },
  { id: 1573406654, typ: 'Odeslaná',  adresat: 'Základní škola s rozšířenou výukou hudební výchovy Teplice Maršovská 1575/1', predmet: 'Oznámení ředitelce základní školy o přestupu žáka',                             datum: '04.09.2025' },
  { id: 1572624258, typ: 'Odeslaná',  adresat: 'Ústecký kraj',                                                           predmet: 'Žádost o poskytnutí dotace na školní rok 2025/2026',                                     datum: '03.09.2025' },
  { id: 1656110641, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Avízo záloha UZ 33 155 - ÚNOR 2026 Vilekula',                                            datum: '26.02.2026' },
  { id: 1655643866, typ: 'Přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'Informace o zařazení školy do zjišťování výsledků vzdělávání 2026',                     datum: '25.02.2026' },
  { id: 1654663762, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Kapacita Datového trezoru je naplněna',                                                   datum: '25.02.2026' },
  { id: 1653641863, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Datový trezor na zkoušku vyprší za 7 dnů',                                               datum: '21.02.2026' },
  { id: 1653593703, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A3082 Sdělení o registraci změny agendy',                                                datum: '21.02.2026' },
  { id: 1653593702, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A8566 Sdělení o registraci změny agendy',                                                datum: '21.02.2026' },
  { id: 1653593645, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A4067 Sdělení o registraci změny agendy',                                                datum: '21.02.2026' },
  { id: 1653593586, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A112 Sdělení o registraci změny agendy',                                                 datum: '21.02.2026' },
  { id: 1653593571, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A113 Sdělení o registraci změny agendy',                                                 datum: '21.02.2026' },
  { id: 1653593527, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A14633 Sdělení o registraci změny agendy',                                               datum: '21.02.2026' },
  { id: 1653593526, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A345 Sdělení o registraci změny agendy',                                                 datum: '21.02.2026' },
  { id: 1653592746, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'A9145 Sdělení o registraci změny agendy',                                                datum: '21.02.2026' },
  { id: 1651347156, typ: 'Přijatá',   adresat: 'Krajský soud v Ústí nad Labem',                                         predmet: 'Dokumenty z Obchodního rejstříku',                                                        datum: '17.02.2026' },
  { id: 1651244418, typ: 'Přijatá',   adresat: 'Základní škola Proboštov',                                              predmet: 'RE:Oznámení o přestupu žáka žádost a předání katalogového listu',                        datum: '17.02.2026' },
  { id: 1650658105, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Upravené hlášení výkonů k poslednímu dni v měsíci - školní stravování ve veřejném zařízení', datum: '16.02.2026' },
  { id: 1650537270, typ: 'Přijatá',   adresat: 'Základní škola Proboštov',                                              predmet: 'Oznámení o přestupu žáka žádost a předání katalogového listu',                          datum: '16.02.2026' },
  { id: 1649349854, typ: 'Přijatá',   adresat: 'Krajský soud v Ústí nad Labem',                                         predmet: 'Dokumenty z Obchodního rejstříku',                                                        datum: '12.02.2026' },
  { id: 1647847912, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Kapacita Datového trezoru je naplněna',                                                   datum: '10.02.2026' },
  { id: 1645655887, typ: 'Přijatá',   adresat: 'Ministerstvo školství mládeže a tělovýchovy',                           predmet: 'Pozvánka ke sledování odborného panelu - Role a kompetence školské rady',               datum: '04.02.2026' },
  { id: 1644594386, typ: 'Přijatá',   adresat: 'Registr smluv (DIA)',                                                   predmet: 'Zveřejnění smlouvy: Smlouva o poskytnutí základní dotace – školské služby na školní rok 2026/2027 (D)', datum: '04.02.2026' },
  { id: 1644104017, typ: 'Přijatá',   adresat: 'Česká pošta s.p.',                                                      predmet: 'Jak snadno prodloužit Datový trezor',                                                     datum: '04.02.2026' },
  { id: 1642883899, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Avízo 33 155 Leden 2026 ZŠ Vilekula',                                                    datum: '30.01.2026' },
  { id: 1642297758, typ: 'Přijatá',   adresat: 'Registr smluv (DIA)',                                                   predmet: 'Zveřejnění smlouvy: Dodatek č. 1 smlouvy o poskytnutí základní dotace – školské služby na školní rok 2025/2026 (D)', datum: '30.01.2026' },
  { id: 1642187712, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Datový trezor na zkoušku vyprší za 30 dnů',                                              datum: '30.01.2026' },
  { id: 1641140507, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Smlouva č. 26_SML000784_SOPD_SMT',                                                       datum: '27.01.2026' },
  { id: 1641138261, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Dodatky ke smlouvám školní stravování Vilekula',                                         datum: '27.01.2026' },
  { id: 1641063528, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Informační dopis Vilekula',                                                               datum: '27.01.2026' },
  { id: 1640962806, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Kapacita Datového trezoru je naplněna',                                                   datum: '27.01.2026' },
  { id: 1632453700, typ: 'Přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: 'Kapacita Datového trezoru je naplněna',                                                   datum: '13.01.2026' },
  { id: 1630136084, typ: 'Přijatá',   adresat: 'OSSZ Teplice',                                                           predmet: 'dopis JMHZ',                                                                             datum: '09.01.2026' },
  { id: 1629298423, typ: 'Přijatá',   adresat: 'Registr smluv (DIA)',                                                   predmet: 'Zveřejnění smlouvy: zajištění stravování',                                               datum: '06.01.2026' },
  { id: 1623059691, typ: 'Přijatá',   adresat: 'Vojenská zdravotní pojišťovna České republiky',                         predmet: 'Informace o změnách k 1. 1. 2026',                                                       datum: '18.12.2025' },
  { id: 1622752506, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Dodatek ke smlouvě o poskytnutí dotace na ŠR 25/26 školní stravování',                  datum: '17.12.2025' },
  { id: 1618185385, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'OVM23136316 Sdělení o změně OVM',                                                        datum: '09.12.2025' },
  { id: 1617470901, typ: 'Přijatá',   adresat: 'Automat ZR (DIA)',                                                       predmet: 'Výpis z Registru osob',                                                                   datum: '09.12.2025' },
  { id: 1617439841, typ: 'Přijatá',   adresat: 'Informační systém datových schránek',                                    predmet: 'Systémová zpráva typ 18a - změna datové schránky z PO na OVM_PO',                       datum: '09.12.2025' },
  { id: 1617311717, typ: 'Přijatá',   adresat: 'DIA (automat § 53-57)',                                                  predmet: 'OVM23136316 Sdělení o zápisu OVM',                                                       datum: '08.12.2025' },
  { id: 1587864651, typ: 'Přijatá',   adresat: 'Česká pošta s.p.',                                                      predmet: 'Faktura',                                                                                 datum: '06.10.2025' },
  { id: 1586819509, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Avízo platby mimořádné zálohy na dotace 4.Q/2025 - Základní škola Vilekula Teplice',   datum: '03.10.2025' },
  { id: 1583986163, typ: 'Přijatá',   adresat: 'Centrum pro zjišťování výsledků vzdělávání',                            predmet: 'Přijímačky na nečisto 2026',                                                             datum: '28.09.2025' },
  { id: 1581560995, typ: 'Přijatá',   adresat: 'VŠEOBECNÁ ZDRAVOTNÍ POJIŠŤOVNA ČESKÉ REPUBLIKY',                        predmet: 'ID_Listek_zamestnavatele',                                                                datum: '22.09.2025' },
  { id: 1579612917, typ: 'Přijatá',   adresat: 'Zdravotní pojišťovna ministerstva vnitra České republiky',               predmet: 'pristupove kody',                                                                         datum: '17.09.2025' },
  { id: 1577300310, typ: 'Přijatá',   adresat: 'Registr smluv (DIA)',                                                   predmet: 'Zveřejnění smlouvy: Smlouva o poskytnutí základní dotace - školské služby na školní rok 2025/2026 (D)', datum: '12.09.2025' },
  { id: 1575287446, typ: 'Přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Smlouva 25/SML002878-6450/SOPD/SMT',                                                     datum: '09.09.2025' },
  { id: 1573573038, typ: 'Přijatá',   adresat: 'Základní škola s rozšířenou výukou hudební výchovy Teplice Maršovská 1575/1', predmet: 'Katalogový list žáka',                                                          datum: '04.09.2025' },
  { id: 1573319775, typ: 'Přijatá',   adresat: 'Pedagogicko-psychologická poradna Ústeckého kraje',                     predmet: 'Lebovič Vilém 1.5.2017 Doporučení ŠPZ',                                                  datum: '04.09.2025' },
  { id: 1572625018, typ: 'Přijatá',   adresat: 'Automat ZR (DIA)',                                                       predmet: 'Výpis z Registru osob',                                                                   datum: '02.09.2025' },
  // --- novější záznamy (formát YYYY-MM-DD HH:mm) ---
  { id: 1658287578, typ: 'přijatá',   adresat: 'Martina Frlaus Bendová',                                                 predmet: 'Žádost o odklad školní docházky',                                                         datum: '2026-03-03 7:47' },
  { id: 1609247391, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: '(bez předmětu)',                                                                          datum: '2025-11-21 15:34' },
  { id: 1609393349, typ: 'přijatá',   adresat: 'Systémová schránka provozovatele ISDS',                                  predmet: '(bez předmětu)',                                                                          datum: '2025-11-22 0:44' },
  { id: 1605442843, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: '(bez předmětu)',                                                                          datum: '2025-11-13 8:46' },
  { id: 1599494406, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: '(bez předmětu)',                                                                          datum: '2025-10-31 11:36' },
  { id: 1593837136, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: '(bez předmětu)',                                                                          datum: '2025-10-18 7:32' },
  { id: 1659288218, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Exekuce srážkami ze mzdy a z jiných příjmů',                                             datum: '2026-03-04 14:02' },
  { id: 1659351351, typ: 'přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'Odpověď – Žádost o zařazení do plánu inspekční činnosti',                               datum: '2026-03-04 15:13' },
  { id: 1660250382, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Informování právnické osoby o důvodech neuzavření zvýšené smlouvy na ŠR 26/27',         datum: '2026-03-06 7:31' },
  { id: 1664561118, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Přestup žáka',                                                                            datum: '2026-03-16 10:26' },
  { id: 1665204106, typ: 'přijatá',   adresat: 'Statutární město Teplice',                                               predmet: 'vzor 809: "prostor pro provoz Základní školy Vilekula Teplice"',                         datum: '2026-03-17 8:49' },
  { id: 1668359809, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Vyrozumění o nabytí právní moci',                                                         datum: '2026-03-23 14:00' },
  { id: 1669812481, typ: 'přijatá',   adresat: 'Martina Frlaus Bendová',                                                 predmet: 'RE:Žádost o odklad školní docházky',                                                     datum: '2026-03-25 13:34' },
  { id: 1670886921, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Avízo 33 155 Březen 2026 ZŠ Vilekula',                                                   datum: '2026-03-27 7:46' },
  { id: 1674988025, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Informace k JMHZ',                                                                        datum: '2026-04-05 4:03' },
  { id: 1678876536, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'PRCH 2026 - Zařazení do seznamu náhradníků',                                             datum: '2026-04-13 13:46' },
  { id: 1680259021, typ: 'přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'KIČ - ZŠ Vilekula, Teplice',                                                             datum: '2026-04-15 11:11' },
  { id: 1680258990, typ: 'přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'oznámení inspekční činnosti zřizovateli - Efraim Dlouhá punčocha, z.s., IČO: 22 004 459', datum: '2026-04-15 11:11' },
  { id: 1683519441, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Rozhodnutí',                                                                              datum: '2026-04-21 8:15' },
  { id: 1688101072, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Avízo 33 155 - 2. Q 2026 ZŠ Vilekula',                                                   datum: '2026-04-28 12:16' },
  { id: 1698436525, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'JMHZ Protokol o kompletnosti podání 5582038575 01/2026 05/14/2026 10:26:56',            datum: '2026-05-17 8:28' },
  { id: 1699536670, typ: 'přijatá',   adresat: 'Statutární město Teplice',                                               predmet: 'Oznámení usnesení RM',                                                                    datum: '2026-05-19 10:07' },
  { id: 1699643627, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Zastavení exekuce',                                                                       datum: '2026-05-19 11:59' },
  { id: 1703355403, typ: 'přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'Informace o zastavení testování žáků 5. a 9. tříd',                                     datum: '2026-05-26 10:18' },
  { id: 1705341676, typ: 'přijatá',   adresat: 'Česká školní inspekce',                                                  predmet: 'KIČ - ZŠ Vilekula, Teplice',                                                             datum: '2026-05-29 11:21' },
  { id: 1705787301, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'JMHZ Protokol o kompletnosti podání 5582038575 04/2026 05/15/2026 14:08:41',            datum: '2026-05-30 20:36' },
  { id: 1705787308, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'JMHZ Protokol o kompletnosti podání 5582038575 02/2026 05/15/2026 14:06:56',            datum: '2026-05-30 20:36' },
  { id: 1705787809, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'JMHZ Protokol o kompletnosti podání 5582038575 03/2026 05/15/2026 14:07:49',            datum: '2026-05-30 20:42' },
  { id: 1711574424, typ: 'přijatá',   adresat: 'Ministerstvo školství, mládeže a tělovýchovy',                          predmet: 'Dopis PM R. Plagy (MŠMT) - Informace k probíhající kurikulární reformě (úpravy RVP)',   datum: '2026-06-09 19:16' },
  { id: 1712862352, typ: 'přijatá',   adresat: 'Ústecký kraj',                                                           predmet: 'Informace a požadavky spojené se závěrem školního roku 2025/2026',                      datum: '2026-06-11 14:17' },
  { id: 1713705744, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'Odpověď na ePodání JMH Protokol o kompletnosti VS5582038575-05/2026-Hlášení je zpracováno a je úplné', datum: '2026-06-12 20:10' },
  { id: 1721084029, typ: 'přijatá',   adresat: 'neznámý',                                                                predmet: 'A3082 Sdělení o registraci změny agendy',                                                datum: '2026-06-24 21:36' },
  { id: 1721873991, typ: 'přijatá',   adresat: 'Ministerstvo školství, mládeže a tělovýchovy',                          predmet: 'Rozhodnutí - zápis změny vyhověno - Základní škola Vilekula Teplice',                   datum: '2026-06-26 8:01' },
]

// ============================================================
// POMOCNÉ FUNKCE
// ============================================================

function parseDatum(s: string): string {
  // 'DD.MM.YYYY' → 'YYYY-MM-DD'
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    const [d, m, y] = s.split('.')
    return `${y}-${m}-${d}`
  }
  // 'YYYY-MM-DD H:mm' nebo 'YYYY-MM-DD HH:mm' → 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.split(' ')[0]
  }
  throw new Error(`Neznámý formát datumu: ${s}`)
}

function normalizTyp(typ: string): 'prijaty' | 'odchozi' {
  const t = typ.toLowerCase()
  if (t.includes('přijat')) return 'prijaty'
  if (t.includes('odeslan')) return 'odchozi'
  throw new Error(`Neznámý typ: ${typ}`)
}

// Mapování názvu adresáta na věcnou skupinu
// Prioritní pořadí: specifičtější pravidla první
function odhadniVecnouSkupinu(adresat: string, predmet: string): string {
  const a = adresat.toLowerCase()
  const p = predmet.toLowerCase()

  // Systémové zprávy ISDS → S/5 dle čl. III/2.3 Spisového řádu
  if (a.includes('systémová schránka') || a.includes('isds')) return '1.8.1'
  if (a.includes('dia (automat') || a.includes('automat zr')) return '1.8.1'
  if (a.includes('česká pošta') && p.includes('datový trezor')) return '1.8.1'

  // Dotace a smlouvy
  if (p.includes('smlouva') || p.includes('dodatek ke smlouv')) return '6.3.2'
  if (p.includes('dotace') || p.includes('žádost o') && p.includes('dotaci')) return '6.2.2'
  if (p.includes('hlášení výkonů')) return '6.2.3'
  if (p.includes('výkaz r') || p.includes('výkaz p 1-04')) return '6.2.4'
  if (p.includes('avízo') || p.includes('avizo')) return '6.2.1'
  if (p.includes('zveřejnění smlouvy')) return '6.3.2'

  // Přestupy
  if (p.includes('přestup') || p.includes('katalogový list')) return '3.2.1'

  // Odklady
  if (p.includes('odklad')) return '3.1.2'

  // ČŠI inspekce
  if (a.includes('česká školní inspekce')) return '1.7.1'

  // Soudy a exekuce
  if (a.includes('krajský soud') || p.includes('exekuce') || p.includes('právní moci') || p.includes('obchodní rejstřík')) return '8.2.5'

  // OSSZ / ZP / FÚ
  if (a.includes('ossz') || a.includes('pojišťovna') || a.includes('zdravotní pojišťovna')) return '5.3.1'

  // PPP
  if (a.includes('pedagogicko-psychologická')) return '8.1.1'

  // MŠMT
  if (a.includes('ministerstvo školství')) return '8.2.1'

  // Ústecký kraj — obecná korespondence
  if (a.includes('ústecký kraj')) return '8.2.3'

  // Statutární město Teplice
  if (a.includes('statutární město teplice')) return '8.3.2'

  // Registr smluv
  if (a.includes('registr smluv')) return '8.2.6'

  // Jiné školy
  if (a.includes('základní škola') || a.includes('škola')) return '8.3.1'

  // Fyzické osoby (zákonní zástupci)
  if (a === 'neznámý' || /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(adresat)) return '1.8.1'

  // Fallback
  return '1.8.1'
}

// ============================================================
// HLAVNÍ IMPORT
// ============================================================

async function main() {
  console.log('Načítám jmenný rejstřík...')

  const { data: rejstrik, error: rejErr } = await supabase
    .from('jmenny_rejstrik')
    .select('id, nazev, id_ds')

  if (rejErr) throw rejErr

  // Index nazev → id (lowercase pro case-insensitive shodu)
  const subjektIndex = new Map<string, string>()
  for (const r of rejstrik ?? []) {
    subjektIndex.set(r.nazev.toLowerCase(), r.id)
  }

  console.log('Načítám věcné skupiny...')
  const { data: skupiny, error: skErr } = await supabase
    .from('vecne_skupiny')
    .select('id, spis_znak')

  if (skErr) throw skErr

  const skupinaIndex = new Map<string, string>()
  for (const s of skupiny ?? []) {
    skupinaIndex.set(s.spis_znak, s.id)
  }

  // Deduplikace: DS ID může být v sheetu duplicitní (odeslaná + přijatá se stejným ID)
  // Zpráva 1650537270 a 1648072849 jsou v sheetu dvakrát — jednou jako odeslaná, jednou jako přijatá
  // Zachováme obě jako samostatné dokumenty (různý smer)
  const seen = new Set<string>()
  let vlozeno = 0
  let preskoceno = 0
  let chyby = 0

  for (const radek of DS_LOG) {
    const smer = normalizTyp(radek.typ)
    const klic = `${radek.id}_${smer}`

    if (seen.has(klic)) {
      console.warn(`  SKIP duplikát: ${klic}`)
      preskoceno++
      continue
    }
    seen.add(klic)

    const datum = parseDatum(radek.datum)
    const rok = parseInt(datum.split('-')[0])

    const skupinaZnak = odhadniVecnouSkupinu(radek.adresat, radek.predmet)
    const skupinaId = skupinaIndex.get(skupinaZnak)
    if (!skupinaId) {
      console.error(`  CHYBA: věcná skupina ${skupinaZnak} nenalezena pro ID ${radek.id}`)
      chyby++
      continue
    }

    // Hledání subjektu (case-insensitive, toleruje "neznámý")
    const subjektId = radek.adresat === 'neznámý'
      ? null
      : (subjektIndex.get(radek.adresat.toLowerCase()) ?? null)

    // Skartační lhůta z věcné skupiny (pro datum_zahajeni_lhuty)
    // Trigger essl_generuj_cj nastaví datum_zahajeni_lhuty = 1. 1. roku+1
    // ale ten počítá s CURRENT_DATE — pro historické záznamy to bude špatně.
    // Nastavíme explicitně při insertu.
    const datumZahajeni = `${rok + 1}-01-01`

    const { error } = await supabase
      .from('dokumenty')
      .insert({
        smer,
        predmet: radek.predmet,
        datum_vzniku: datum,
        datum_prijeti: smer === 'prijaty' ? datum : null,
        zpusob_doruceni: 'datova_schranka',
        ds_zprava_id: radek.id,
        vecna_skupina_id: skupinaId,
        subjekt_id: subjektId,
        subjekt_nazev_cache: radek.adresat === 'neznámý' ? null : radek.adresat,
        stav: 'uzavreno',    // historické dokumenty jsou vyřízené
        datum_zahajeni_lhuty: datumZahajeni,
        prilohy: [],
        poznamka: 'Import z historického DS logu (Google Sheets, sheet datovka)',
      })

    if (error) {
      console.error(`  CHYBA insert ID ${radek.id}: ${error.message}`)
      chyby++
    } else {
      console.log(`  OK  ${smer.padEnd(8)} ${datum}  ${String(radek.id).padEnd(12)}  ${radek.predmet.substring(0, 60)}`)
      vlozeno++
    }
  }

  console.log('\n========================================')
  console.log(`Vloženo:    ${vlozeno}`)
  console.log(`Přeskočeno: ${preskoceno}`)
  console.log(`Chyby:      ${chyby}`)
  console.log('========================================')

  if (chyby > 0) {
    console.error('Import dokončen s chybami — zkontroluj výstup výše.')
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
