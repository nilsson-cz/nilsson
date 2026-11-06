-- =============================================================================
-- Migrace 172 — Úrazy + Nástěnka: oprava časové zóny uložených časů
--
-- Chyba: formuláře posílaly hodnotu <input type="datetime-local">
-- ('2026-11-10T14:00', bez zóny) a server (Vercel, UTC) ji uložil jako
-- 14:00 UTC místo 14:00 Europe/Prague. Uložené časy jsou o 1 h (SEČ) / 2 h
-- (SELČ) posunuté oproti zadání.
--   • Úrazy:    app/actions/urazy.ts ts() = new Date(v).toISOString() na serveru
--               → urazy_zaznam.datum_cas, urazy_zaznam.zz_vyrozumen_datum_cas
--               (jediná zápisová cesta od vzniku modulu, migrace 109/111).
--   • Nástěnka: datetime-local šel rovnou do insertu/PATCHe, Postgres ho vyložil
--               v UTC → bulletin_posts.event_date (od vzniku modulu, 025).
--               Editace (/dashboard/bulletin/[id]/edit) posílala jen DATUM
--               ('2026-11-10' = půlnoc UTC), takže čas upravených akcí se ztratil.
--
-- Oprava: čas na hodinách (tak, jak je uložený v UTC) vyložit jako pražský.
--   (ts AT TIME ZONE 'UTC')            → timestamp bez zóny = zadané „14:00"
--   ... AT TIME ZONE 'Europe/Prague'   → timestamptz 14:00 pražského času
-- Akce, jejichž čas se ztratil editací (00:00 UTC), tím skončí na půlnoci
-- pražského času správného dne — čas je potřeba doplnit ručně (náhled 1b).
--
-- ⚠ SPUSTIT JEN JEDNOU a TĚSNĚ PŘED nasazením opravy kódu (merge PR).
--   Záznamy uložené už opraveným kódem by se posunuly podruhé. Mezi spuštěním
--   a nasazením nezakládat ani neupravovat úrazy a akce na Nástěnce.
--
-- ⚠ Úrazy již odeslané do ČŠI (odeslano_csi_at): InspIS dostal původní
--   (posunutou) hodnotu. Po opravě se náš záznam bude od InspIS lišit — viz
--   náhled 1a, případně opravit v InspIS ručně.
-- =============================================================================

-- ── 1a) Náhled Úrazy (spustit samostatně PŘED úpravou) ──────────────────────
-- „nyni" = jak se čas teď zobrazuje, „po_oprave" = jak se bude zobrazovat.
-- „po_oprave" má odpovídat času, který ředitel do formuláře zadal.
--
-- SELECT poradove_cislo, skolni_rok, zraneny_prijmeni,
--        to_char(datum_cas AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS nyni,
--        to_char(datum_cas AT TIME ZONE 'UTC',           'DD.MM.YYYY HH24:MI') AS po_oprave,
--        to_char(zz_vyrozumen_datum_cas AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS zz_nyni,
--        to_char(zz_vyrozumen_datum_cas AT TIME ZONE 'UTC',           'DD.MM.YYYY HH24:MI') AS zz_po_oprave,
--        odeslano_csi_at
--   FROM urazy_zaznam
--  WHERE datum_cas IS NOT NULL OR zz_vyrozumen_datum_cas IS NOT NULL
--  ORDER BY datum_cas;

-- ── 1b) Náhled Nástěnka (spustit samostatně PŘED úpravou) ───────────────────
-- „cas_ztracen" = akce upravená přes editaci (uloženo jen datum) → po opravě
-- 00:00, čas akce doplnit ručně.
--
-- SELECT id, title,
--        to_char(event_date AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS nyni,
--        to_char(event_date AT TIME ZONE 'UTC',           'DD.MM.YYYY HH24:MI') AS po_oprave,
--        to_char(event_date AT TIME ZONE 'UTC', 'HH24:MI:SS') = '00:00:00'      AS cas_ztracen,
--        email_sent_at, created_at
--   FROM bulletin_posts
--  WHERE event_date IS NOT NULL
--  ORDER BY event_date;

-- ── 2) Oprava ────────────────────────────────────────────────────────────────

BEGIN;

UPDATE urazy_zaznam
   SET datum_cas              = (datum_cas              AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague',
       zz_vyrozumen_datum_cas = (zz_vyrozumen_datum_cas AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'
 WHERE datum_cas IS NOT NULL OR zz_vyrozumen_datum_cas IS NOT NULL;

-- Lock trigger (025) blokuje změnu event_date u odeslaných příspěvků;
-- updated_at necháváme beze změny (jde o opravu dat, ne editaci).
ALTER TABLE bulletin_posts DISABLE TRIGGER trg_bulletin_posts_lock;
ALTER TABLE bulletin_posts DISABLE TRIGGER trg_bulletin_posts_updated_at;

UPDATE bulletin_posts
   SET event_date = (event_date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Prague'
 WHERE event_date IS NOT NULL;

ALTER TABLE bulletin_posts ENABLE TRIGGER trg_bulletin_posts_lock;
ALTER TABLE bulletin_posts ENABLE TRIGGER trg_bulletin_posts_updated_at;

COMMIT;

-- ── 3) Kontrola po úpravě (spustit samostatně) ───────────────────────────────
-- Časy musí odpovídat zadání; oba triggery musí být zase zapnuté (tgenabled = 'O').
--
-- SELECT poradove_cislo, to_char(datum_cas AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS cas
--   FROM urazy_zaznam ORDER BY datum_cas;
-- SELECT title, to_char(event_date AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') AS cas
--   FROM bulletin_posts WHERE event_date IS NOT NULL ORDER BY event_date;
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'bulletin_posts'::regclass AND NOT tgisinternal;
