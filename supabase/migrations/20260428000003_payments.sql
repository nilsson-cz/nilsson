-- =============================================================================
-- 003_payments.sql — Fáze 2: Školní akce a platební modul
-- =============================================================================
-- Závislosti: 000_init.sql, 001_matrika.sql
-- RLS politiky: viz 006_rls.sql sekce L (doplnit po spuštění tohoto souboru)
--
-- Obsah:
--   A. events           — školní akce (prerekvizita platebního modulu)
--   B. payment_obligations  — pohledávky (co žák dluží)
--   C. payment_transactions — transakce importované z Fio API
--   D. payment_matches      — párování transakce ↔ pohledávka
--
-- Architektura Fio integrace:
--   Edge Function `import-fio-transactions` (denně nebo manuální trigger):
--     GET fio.cz/ib_api/rest/last/{token}/transactions.json
--     → parse → match přes variable_symbol = students.kod_zaka (4místné číslo)
--     → INSERT payment_transactions (match_status = 'matched' / 'unmatched')
--     → unmatched → INSERT system_alerts (module='payments', severity='warning')
--     → Discord webhook notifikace při nezaplacené pohledávce po due_date
--
-- Variabilní symbol: 4místné pořadové číslo ze sekvence kod_zaka_seq
--   (posledních N číslic kod_zaka, např. VIL-2016-0007 → VS = 0007)
--
-- Přístupová matice (TRD sekce 8.1):
--   events:              všichni čtou; director/vp zapisují
--   payment_*:           director ALL; vp/readonly SELECT; guide/assistant bez přístupu
-- =============================================================================


-- =============================================================================
-- A. EVENTS — školní akce
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A.1 events — jednodenní i vícedenní akce školy
-- -----------------------------------------------------------------------------
-- Primární účel: generování platebních pohledávek per žák.
-- Sekundárně: integrace s třídní knihou (typ_zaznamu IN ('expedice', 'projekt', ...)).
--
-- Workflow pohledávek:
--   1. Director/průvodce vytvoří akci
--   2. UI nabídne „generovat pohledávky" → INSERT do payment_obligations per žák
--   3. Generování je explicitní manuální krok — průvodce může vybrat podmnožinu žáků
--   Automatický trigger na events NENÍ — variabilní výše, výjimky, stornování

CREATE TABLE events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  date_from      DATE NOT NULL,
  date_to        DATE,                      -- NULL = jednodenní akce
  school_year    TEXT NOT NULL,             -- '2025/2026'
  default_amount NUMERIC(10,2),             -- výchozí částka pro generování pohledávek;
                                            -- NULL = akce bez standardní ceny
  created_by     UUID NOT NULL REFERENCES staff(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT check_event_dates CHECK (date_to IS NULL OR date_to >= date_from)
);

CREATE INDEX ON events (school_year, date_from);
CREATE INDEX ON events (date_from);

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- B. PAYMENT_OBLIGATIONS — pohledávky
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B.1 payment_obligations — co žák dluží
-- -----------------------------------------------------------------------------
-- Jeden řádek = jedna pohledávka jednoho žáka.
-- Pro 'event': reference_event_id NOT NULL (zajištěno CHECK constraintem).
-- Pro 'tuition': period = 'YYYY-MM' (měsíční školné), validated regexem.
--
-- Lifecycle pohledávky:
--   INSERT (director/vp) → čeká na platbu → Edge Function spáruje přes payment_matches
--   Přeplatek: matched_amount může přesáhnout amount — zachytit v UI upozorněním
--   Pohledávka se NEMAŽE — storno přes novou pohledávku s zápornou hodnotou (donation/credit)

CREATE TABLE payment_obligations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  type               TEXT NOT NULL CHECK (type IN ('tuition', 'event', 'lunch', 'donation')),
  amount             NUMERIC(10,2) NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'CZK',
  due_date           DATE NOT NULL,
  reference_event_id UUID REFERENCES events(id),
  school_year        TEXT NOT NULL,
  period             TEXT CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  created_by         UUID NOT NULL REFERENCES staff(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Typ 'event' musí mít reference_event_id
  CONSTRAINT check_event_ref CHECK (
    type != 'event' OR reference_event_id IS NOT NULL
  ),
  -- Typ 'tuition' a 'lunch' by měl mít period; ostatní typy period nepotřebují
  -- (informativní, silnější validace na aplikační vrstvě)
  CONSTRAINT check_amount_positive CHECK (amount != 0)
  -- Záporné amount je záměrně povoleno pro dobropis/kredit
);

CREATE INDEX ON payment_obligations (student_id, due_date DESC);
CREATE INDEX ON payment_obligations (school_year, type, due_date);
CREATE INDEX ON payment_obligations (reference_event_id) WHERE reference_event_id IS NOT NULL;
CREATE INDEX ON payment_obligations (student_id, school_year);

CREATE TRIGGER trg_payment_obligations_updated_at
  BEFORE UPDATE ON payment_obligations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- C. PAYMENT_TRANSACTIONS — transakce z Fio API
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C.1 payment_transactions — každá transakce z bankovního účtu
-- -----------------------------------------------------------------------------
-- Jeden řádek = jedna transakce z Fio API.
-- fio_transaction_id: UNIQUE — idempotentní import (opakovaný import nevytvoří duplikát).
--
-- match_status sémantika:
--   'unmatched'       → variable_symbol nenalezen v students.kod_zaka, nebo VS chybí
--   'matched'         → auto-match přes Edge Function (VS = kod_zaka)
--   'manual_override' → ručně spárováno/opraveno uživatelem v UI
--
-- Kdo provedl manuální override: dohledatelné přes payment_matches.matched_by
-- (NULL = auto-match z Edge Function, NOT NULL = manuální zásah staff)
--
-- Transakce se NEMAŽE — append-only v praxi (žádné RULE, ale UI mazání nenabízí)

CREATE TABLE payment_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fio_transaction_id   TEXT UNIQUE NOT NULL,  -- ID z Fio API — základ idempotence
  student_id           UUID REFERENCES students(id),   -- NULL pokud nespárováno
  variable_symbol      TEXT,                  -- jak přišel z banky (neupravovat)
  amount               NUMERIC(10,2) NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'CZK',
  counterparty_name    TEXT,
  counterparty_account TEXT,
  transaction_date     DATE NOT NULL,
  note                 TEXT,                  -- Fio zpráva pro příjemce + interní komentář
  imported_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  match_status         TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN (
                         'matched', 'unmatched', 'manual_override'
                       ))
);

CREATE INDEX ON payment_transactions (variable_symbol);
CREATE INDEX ON payment_transactions (match_status) WHERE match_status != 'matched';
CREATE INDEX ON payment_transactions (transaction_date DESC);
CREATE INDEX ON payment_transactions (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX ON payment_transactions (imported_at DESC);

CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON payment_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
-- D. PAYMENT_MATCHES — párování transakce ↔ pohledávka
-- =============================================================================

-- -----------------------------------------------------------------------------
-- D.1 payment_matches — M:N párování s částkou
-- -----------------------------------------------------------------------------
-- Jeden řádek = jedno párování.
-- Jedna transakce může pokrýt více pohledávek (přeplatek rozdělený ručně).
-- Jedna pohledávka může být pokryta více transakcemi (splátky).
--
-- matched_by:
--   NULL     = auto-match (Edge Function)
--   NOT NULL = manuální párování staff v UI
--
-- Párování se NEMAŽE — storno přes nový záznam (edge case, dokumentovat v UI)
-- Kontrolu přeplatku (SUM(matched_amount) > obligation.amount) zajišťuje aplikační vrstva

CREATE TABLE payment_matches (
  transaction_id  UUID NOT NULL REFERENCES payment_transactions(id),
  obligation_id   UUID NOT NULL REFERENCES payment_obligations(id),
  matched_amount  NUMERIC(10,2) NOT NULL,
  matched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_by      UUID REFERENCES staff(id),  -- NULL = auto, NOT NULL = manuální
  PRIMARY KEY (transaction_id, obligation_id),

  CONSTRAINT check_matched_amount_positive CHECK (matched_amount > 0)
);

CREATE INDEX ON payment_matches (obligation_id);
CREATE INDEX ON payment_matches (transaction_id);
