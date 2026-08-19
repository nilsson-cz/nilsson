# Runbook: Hygiena projektu Nilsson

Opakovatelný postup na údržbu čistoty systému — backend (DB) i frontend.
Doprovodné SQL: [`scripts/db-audit.sql`](./db-audit.sql).

## Proč to potřebujeme (specifika Nilssona)

1. **Migrace se pouští ručně v Supabase**, ne přes CLI → živá DB se rozjíždí
   s migračními soubory i s `types/database.ts`.
2. **Vícepříkazové migrace mohou doběhnout jen zčásti** → půl-vytvořené objekty.
3. **`web` schéma není v migracích vůbec** — a už jednou shodilo produkci.
4. **Stovky `(supabase as any)`** obcházejí typy i FK → osiřelá data se hromadí
   potichu.

Proto je hygiena **opakovaný proces**, ne jednorázový úklid.

## Kadence

- **Čtvrtletně**: plný hygienický sprint (½ dne) dle checklistu níže.
- **Před každým větším releasem**: jen krok 1 (drift-check).

## 🔒 Zlaté pravidlo: nikdy DROP napřímo

Web už jednou spadl kvůli přímému zásahu. Vždy **karanténa → pozorování → DROP**:

```sql
-- 1) karanténa (reverzibilní, v logu okamžitě uvidíš, když se něco rozbije)
ALTER TABLE public.podezrela_tabulka RENAME TO _attic_podezrela_tabulka;
-- 2) 1–2 týdny sledovat error logy / Discord alerty (modul monitoring infra)
-- 3) teprve pak
DROP TABLE public._attic_podezrela_tabulka;
```

U sloupců stejně: `ALTER TABLE x RENAME COLUMN y TO _attic_y;`. Návrat = jeden příkaz.

---

## Checklist sprintu

### 1. Drift typů (backend ↔ kód)

Regeneruj typy z živé DB a porovnej — zachytí i změny ve `web` schématu, které
nejsou v žádné migraci.

**Jednorázově** (jinak `--linked` selže):
```bash
npx --yes supabase login
npx --yes supabase link --project-ref <REF>   # REF z dashboardu, NE "Nilsson" z config.toml
```

**Regenerace** (dvě samostatné příkazy — `→` v poznámkách znamená „a pak"):
```bash
npm run db:types
git diff types/database.ts
```

`db:types` = `scripts/gen-types.mjs`: generuje do paměti, ověří validitu a
`database.ts` přepíše **jen při úspěchu** (na rozdíl od syrového `... > soubor`,
který soubor vyprázdní ještě před během a při selhání/promptu ho rozbije).

Každá neočekávaná změna v diffu = drift. Rozhodni: doplnit chybějící migraci,
nebo srovnat živou DB.

### 2. Backend audit (SQL)

Spusť [`scripts/db-audit.sql`](./db-audit.sql) v Supabase SQL editoru
**pod adminem** (service role — jinak RLS maskuje počty). Projdi dotazy 1–9:

| # | Co hledá | Reakce |
|---|----------|--------|
| 1 | Tabulky-duchové (bez FK/view/funkce) | křížově grepni v kódu → karanténa |
| 2 | RLS zapnuté bez politiky (deny-all) | doplnit politiku, nebo karanténa |
| 2b| Tabulky BEZ RLS | doplnit RLS, pokud drží citlivá data |
| 3 | `*_id` sloupce bez FK | doplnit `FOREIGN KEY ... ON DELETE` |
| 4 | Osiřelé řádky | smazat orphany, pak doplnit FK z bodu 3 |
| 5 | Nevyužité indexy | zvážit `DROP INDEX` |
| 6 | Téměř duplicitní tabulky | rozhodnout o sloučení/migraci |
| 7 | „Studené" tabulky | kandidát na karanténu |
| 8 | Drift (soupis tabulek) | porovnat s bodem 1 |
| 9 | SECURITY DEFINER funkce | ověřit EXECUTE granty (viz migrace 053) |

### 3. Frontend audit (mrtvý kód)

```bash
npx knip          # mrtvé soubory, nepoužité exporty i npm závislosti (hlavní nástroj)
npx ts-prune      # nepoužité exporty (doplňková heuristika)
```

Křížová kontrola DB→FE — tabulka, kterou frontend nikde nepoužívá:

```bash
grep -rl "nazev_tabulky" app lib components || echo "NIKDE — kandidát na backend audit"
```

### 4. Metriky dluhu (trend v čase)

```bash
npm run check:as-any   # počet (supabase as any) vs baseline; CI ho hlídá i na push/PR
```

Ratchet (`scripts/check-as-any.mjs` + `ci.yml`) drží číslo, aby jen klesalo:
nové casty spadnou v CI. Když dluh reálně klesne, sniž `BASELINE` ve scriptu.
Pravidlo: nové tabulky nejdřív `npm run db:types`, ať cast vůbec nevznikne.

### 5. Provést zásahy

- Osiřelá data: smazat.
- Duchové/studené/duplicity: **karanténa** (viz zlaté pravidlo), do kalendáře
  poznámka „za 2 týdny DROP".
- Chybějící FK/RLS: migrace v řadě `supabase/migrations/bez migrace/NNN_*.sql`
  (ruční spuštění v Supabase — pozor na kolize čísel, viz níže).

### 6. Konvence migrací (aby nevznikaly nové sirotky)

- Nová migrace = `bez migrace/NNN_popis.sql`, **NNN vyšší než poslední** (viz `ls`).
- Vyhni se duplicitním prefixům (historicky kolidují 025/027/028/037/050).
- Žádné „(1)" / „copy" / „final" v názvu — jsou to artefakty stažených souborů.
- Vícepříkazové migrace po ručním spuštění **ověř na kompletnost** (mohou
  doběhnout zčásti).

---

## Evidované dluhy k postupnému řešení

_(Aktualizuj při každém sprintu.)_

- [x] ~~`isds-ess.key` / `isds-ess.csr` odtrackovány z gitu + `.gitignore`~~
      (commit 7e82c78). **Rozhodnutí 2026-08-10:** cert se NErotuje (stojí peníze).
      Mitigace klíče v historii = při přechodu IS repa do **veřejného** ho
      přemigrovat jako **jeden squashnutý commit** (historie se nepřenese), viz
      `is-repo-verejny-checklist`. Do té doby držet repo **privátní**.
- [x] ~~Root scratch soubory `login_page.tsx` / `msmt_page.tsx` /
      `portal_platby_page.tsx` smazány.~~
- [x] ~~`025_bulletin (1).sql` → `025_bulletin.sql`.~~
- [x] ~~`*.lnk` do `.gitignore`.~~
- [x] ~~Root `payments.ts` smazán~~ — byl mrtvý duplikát
      `app/actions/payments.ts` (0 importů). **`proxy.ts` NEmazat** — je to
      aktivní Next proxy (access gate pro `/zivot`, volá `lib/zivot-gate.ts`).
- [ ] `(supabase as any)` burndown (baseline **233**). Institucionalizováno:
      `npm run db:types` regeneruje typy, `npm run check:as-any` + CI (`ci.yml`)
      hlídají, že číslo neroste. Vlastní burndown **nedělat naráz** — každý cast
      existuje, protože tabulka není v `database.ts`. Postup: `db:types`, pak rušit
      casty modul po modulu při dotyku, po poklesu snížit BASELINE ve scriptu.
- [ ] Duplicitní prefixy migrací 027/028/037/050. **Nepřejmenovávat** —
      migrace už jsou ručně spuštěné v Supabase; přejmenování je jen kosmetika
      a rozbíjí auditní stopu. Kolize řešit jen u BUDOUCÍCH migrací (unikátní NNN).

## Čtvrtletní připomínka (Discord #nilsson)

Automatická připomínka tohoto sprintu chodí do #nilsson:

- Endpoint: `app/api/cron/hygiena-reminder/route.ts` (chráněn `CRON_SECRET`).
- Plán: `.github/workflows/hygiena-reminder.yml` — 1. den v lednu/dubnu/červenci/
  říjnu (GitHub Actions, stejně jako ostatní extra crony; `vercel.json` má jen 2).
- Test / okamžité spuštění: workflow_dispatch v GitHub UI, nebo
  `curl -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/hygiena-reminder`.

**Ruční jednorázové nastavení (nezvládne Claude — secret + Discord UI):**
1. V Discordu #nilsson → Nastavení kanálu → Integrace → Webhooky → nový webhook,
   zkopírovat URL.
2. Ve Vercelu (Production) přidat env `DISCORD_NILSSON_WEBHOOK_URL` = ta URL.
   (Bez ní endpoint tiše no-opuje, deploy tím nespadne.)
3. Ověřit `CRON_SECRET` je v GitHub repo secrets (už je — sdílený s ostatními crony).
