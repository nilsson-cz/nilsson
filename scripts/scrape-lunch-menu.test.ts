/**
 * scripts/scrape-lunch-menu.test.ts
 * Spuštění:  npx tsx scripts/scrape-lunch-menu.test.ts
 *
 * Pokrývá čisté funkce parseru na reálné podobě stránky SOSTP (vč. záludností:
 * rozbité alergeny "1,,,7", slepené "-polévka", polévka bez alergenů,
 * prázdná šablona dalšího týdne, sekce "Nepřehlédněte").
 */
import { parseMenuText, extractAllergens, inferWeek } from './scrape-lunch-menu.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, `got ${g}, want ${w}`);
}

// „teď“ fixujeme, ať je test deterministický
const NOW = new Date(2026, 5, 13); // 13. 6. 2026

// reálná podoba textu (jak vypadne z htmlToText), vč. navigace a šablony
const FIXTURE = `
Jídelní lístek
Jídelní lístek
Jídelní lístek 15.6. - 19.6.
Pondělí
- polévka vločková 1,9
1. gnocchi s kuřecím masem, list.špenátem a smetanou 1,,,7
2. vepřová pečeně, dušená mrkev, brambory 1,7
3. rýžová kaše se skořicí 7
Úterý
-polévka pórková 1,3,7,9
1. plněné bramborové knedlíky uzeným masem, zelí 1,3
2. smažený květák, brambory, tat.om., salát 1,3,7,10
3. paella s kuřecím masem a chorizem 9
Středa
- polévka marocká s červenou čočkou a cizrnou
1. těstoviny ala lasagne 1,3,7
2. mahi-mahi s hořčičnou omáčkou, pařížské brambůrky 7,10
3. palačinky s džemem, kakao 1,3,7
Čtvrtek
- polévka hov.vývar s čínskými nudlemi 1,9
1. svíčková na smetaně, híuskové knedlíky 1,3,7,9,10
2. špagety Arrabiata 1,3
3. fazole na kyselo, uzená kýta, okurka 1,7
Pátek
- polévka kmínová 1,3,9
1. játra Istria, hranolky 1
2. vepřový guláš, těstoviny 1,3
3. tagliatelle s houbičkami trifolati 1,3
Jídelní lístek
Pondělí
- polévka
Úterý
- polévka
Nepřehlédněte
Třídní schůzky pro budoucí první ročníky
`;

console.log('extractAllergens:');
eq('rozbité "1,,,7" → [1,7]', extractAllergens('gnocchi a smetanou 1,,,7'), {
  text: 'gnocchi a smetanou',
  allergens: [1, 7],
});
eq('bez alergenů', extractAllergens('polévka marocká s červenou čočkou a cizrnou'), {
  text: 'polévka marocká s červenou čočkou a cizrnou',
  allergens: [],
});
eq('jeden alergen', extractAllergens('játra Istria, hranolky 1'), {
  text: 'játra Istria, hranolky',
  allergens: [1],
});
eq('řada alergenů', extractAllergens('svíčková na smetaně, híuskové knedlíky 1,3,7,9,10'), {
  text: 'svíčková na smetaně, híuskové knedlíky',
  allergens: [1, 3, 7, 9, 10],
});
eq('číslo >14 se nebere jako alergen', extractAllergens('pizza pro 20'), {
  text: 'pizza pro 20',
  allergens: [],
});

console.log('inferWeek:');
eq('rok dopočten z „teď“', inferWeek(15, 6, 19, 6, NOW), {
  weekStart: '2026-06-15',
  weekEnd: '2026-06-19',
});
eq('přelom roku (30.12–3.1) v prosinci', inferWeek(30, 12, 3, 1, new Date(2025, 11, 28)), {
  weekStart: '2025-12-30',
  weekEnd: '2026-01-03',
});

console.log('parseMenuText:');
const r = parseMenuText(FIXTURE, NOW);
eq('5 dní', r.days.length, 5);
eq('žádné varování (šablona vynechána, 5 dní)', r.warnings, []);
eq('pondělí datum', r.days[0].menu_date, '2026-06-15');
eq('pátek datum', r.days[4].menu_date, '2026-06-19');
eq('weekday Po=1', r.days[0].weekday, 1);
eq('Po polévka název', r.days[0].soup, 'polévka vločková');
eq('Po polévka alergeny', r.days[0].soup_allergens, [1, 9]);
eq('Po volba 1 alergeny z "1,,,7"', r.days[0].items[0].allergens, [1, 7]);
eq('Po volba 1 popis', r.days[0].items[0].description, 'gnocchi s kuřecím masem, list.špenátem a smetanou');
eq('Út slepené "-polévka"', r.days[1].soup, 'polévka pórková');
eq('St polévka bez alergenů', r.days[2].soup_allergens, []);
eq('Čt volba 1 řada alergenů', r.days[3].items[0].allergens, [1, 3, 7, 9, 10]);
eq('každý den 3 volby', r.days.map((d) => d.items.length), [3, 3, 3, 3, 3]);

console.log('');
if (failures) {
  console.error(`❌ ${failures} test(ů) selhalo`);
  process.exit(1);
} else {
  console.log('✅ všechny testy prošly');
}
