/**
 * lib/manazerske-ucetnictvi/abra-client.ts
 * Klient REST API ABRA Flexi — jen čtení (IS do ABRA nikdy nezapisuje).
 * TRD-manazerske-ucetnictvi-2026-10-18 §2.
 *
 * Bez závislosti na Supabase/Next, aby šel pustit i průzkumným skriptem
 * (scripts/abra-probe.ts) proti demo instanci https://demo.flexibee.eu (demo/winstrom/winstrom).
 *
 * Env: ABRA_URL (např. https://xyz.flexibee.eu), ABRA_FIRMA, ABRA_USER, ABRA_PASSWORD.
 */

export type AbraConfig = { url: string; firma: string; user: string; password: string }

/** Konfigurace z env; null = integrace není nastavená. */
export function abraConfigFromEnv(env: Record<string, string | undefined> = process.env): AbraConfig | null {
  const url = env.ABRA_URL?.trim().replace(/\/+$/, '')
  const firma = env.ABRA_FIRMA?.trim()
  const user = env.ABRA_USER?.trim()
  const password = env.ABRA_PASSWORD
  if (!url || !firma || !user || !password) return null
  return { url, firma, user, password }
}

/** Řádek účetního deníku (evidence ucetni-denik) po převodu na naše typy. */
export type AbraDenikRow = {
  flexi_id: number
  dat_ucto: string
  duzp: string | null
  posting_period: string | null
  doklad: string | null
  id_dokl: number | null
  evidence_path: string | null
  modul: string | null
  md_ucet: string | null
  dal_ucet: string | null
  castka: number
  zakazka: string | null
  stredisko: string | null
  cinnost_abra: string | null
  popis: string | null
  firma: string | null
  dat_splat: string | null
  dat_uhr: string | null
  stav: string | null
  zuctovano: boolean | null
  last_update: string | null
}

export type AbraCiselnikDruh = 'ucet' | 'zakazka' | 'stredisko' | 'cinnost'

export class AbraError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AbraError'
  }
}

const DENIK_FIELDS = [
  'idUcetniDenik', 'lastUpdate', 'datUcto', 'duzpUcto', 'postingPeriod', 'doklad', 'idDokl', 'modul',
  'mdUcet', 'dalUcet', 'sumTuz', 'zakazka', 'stredisko', 'cinnost', 'popis', 'nazFirmy',
  'datSplat', 'datUhr', 'stavUzivK', 'zuctovano',
]

const PAGE = 1000
const RETRY_DELAYS_MS = [1000, 3000, 9000]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * GET na `/c/{firma}/{path}` s Basic Auth. Opakuje při 5xx a síťové chybě
 * (1 s, 3 s, 9 s); 4xx (např. 401 špatné heslo) neopakuje.
 */
async function abraGet(cfg: AbraConfig, path: string): Promise<Record<string, unknown>> {
  const url = `${cfg.url}/c/${encodeURIComponent(cfg.firma)}/${path}`
  const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64')
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      // Vlastní User-Agent je nutný: Flexi (flexibee.eu) vrací na výchozí UA Node fetch 403.
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'IS-Nilsson/1.0' },
        cache: 'no-store',
      })
      if (res.ok) {
        const json = (await res.json()) as { winstrom?: Record<string, unknown> }
        if (!json.winstrom) throw new AbraError('Neočekávaná odpověď Flexi (chybí winstrom)')
        return json.winstrom
      }
      const err = new AbraError(`ABRA Flexi ${res.status} ${res.statusText}`, res.status)
      if (res.status < 500) throw err   // 4xx se opakováním nespraví
      lastErr = err
    } catch (e) {
      if (e instanceof AbraError && e.status !== undefined && e.status < 500) throw e
      lastErr = e
    }
    if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt])
  }
  throw lastErr instanceof Error ? lastErr : new AbraError(String(lastErr))
}

/** Stránkované čtení evidence: dotáhne všechny řádky podle @rowCount. */
async function abraGetAll(cfg: AbraConfig, evidence: string, filter: string | null, query: string) {
  const out: Record<string, string>[] = []
  const base = filter ? `${evidence}/${encodeURIComponent(filter)}.json` : `${evidence}.json`
  for (let start = 0; ; start += PAGE) {
    const w = await abraGet(cfg, `${base}?${query}&limit=${PAGE}&start=${start}&add-row-count=true`)
    const rows = (w[evidence] ?? []) as Record<string, string>[]
    out.push(...rows)
    const total = Number(w['@rowCount'] ?? NaN)
    if (rows.length < PAGE || (Number.isFinite(total) && start + PAGE >= total)) return out
  }
}

// ── Převody hodnot ──────────────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** Relace Flexi „code:518100" → „518100" (prázdné → null). */
export function relCode(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  return s.startsWith('code:') ? s.slice(5) : s
}

/** Datum Flexi „2026-01-01+01:00" → „2026-01-01". */
export function flexiDate(v: unknown): string | null {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

const num = (v: unknown): number | null => {
  const s = str(v)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const bool = (v: unknown): boolean | null => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : null)

export function parseDenikRow(r: Record<string, string>): AbraDenikRow | null {
  const id = num(r.idUcetniDenik)
  const datUcto = flexiDate(r.datUcto)
  if (id === null || !datUcto) return null
  return {
    flexi_id: id,
    dat_ucto: datUcto,
    duzp: flexiDate(r.duzpUcto),
    posting_period: str(r.postingPeriod),
    doklad: str(r.doklad),
    id_dokl: num(r.idDokl),
    evidence_path: str(r['idDokl@evidencePath']),
    modul: str(r.modul),
    md_ucet: relCode(r.mdUcet),
    dal_ucet: relCode(r.dalUcet),
    castka: num(r.sumTuz) ?? 0,
    zakazka: relCode(r.zakazka),
    stredisko: relCode(r.stredisko),
    cinnost_abra: relCode(r.cinnost),
    popis: str(r.popis),
    firma: str(r.nazFirmy),
    dat_splat: flexiDate(r.datSplat),
    dat_uhr: flexiDate(r.datUhr),
    stav: relCode(r.stavUzivK),
    zuctovano: bool(r.zuctovano),
    last_update: str(r.lastUpdate),
  }
}

// ── Veřejné funkce ──────────────────────────────────────────────────────────

/** Všechny řádky účetního deníku s datem zaúčtování v kalendářním roce. */
export async function fetchDenikRok(cfg: AbraConfig, rok: number): Promise<AbraDenikRow[]> {
  const filter = `(datUcto gte "${rok}-01-01" and datUcto lte "${rok}-12-31")`
  const raw = await abraGetAll(cfg, 'ucetni-denik', filter, `detail=custom:${DENIK_FIELDS.join(',')}`)
  return raw.map(parseDenikRow).filter((r): r is AbraDenikRow => r !== null)
}

/** Bankovní doklad ABRA (evidence banka), který ještě není zaúčtovaný — v deníku ho nenajdeme. */
export type AbraBankaDoklad = {
  id: number
  kod: string | null
  datum: string
  castka: number          // příjem +, výdej −
  ucet: string | null     // primární účet (221xxx)
  popis: string | null
  firma: string | null
}

/**
 * Nezaúčtované bankovní doklady s datem vystavení v rozmezí (bez storen).
 * Kontrola je potřebuje, aby pohyb FIO „v bance, ne v účetnictví" rozlišila
 * na „v ABRA je, jen nezaúčtovaný" a „v ABRA chybí".
 */
export async function fetchBankaNezauctovane(cfg: AbraConfig, od: string, doDne: string): Promise<AbraBankaDoklad[]> {
  const filter = `(datVyst gte "${od}" and datVyst lte "${doDne}" and zuctovano eq false and storno eq false)`
  const raw = await abraGetAll(cfg, 'banka', filter, 'detail=custom:id,kod,datVyst,sumCelkem,typPohybuK,primUcet,popis,nazFirmy')
  const out: AbraBankaDoklad[] = []
  for (const r of raw) {
    const id = num(r.id)
    const datum = flexiDate(r.datVyst)
    const castka = num(r.sumCelkem)
    if (id === null || !datum || castka === null) continue
    out.push({
      id, kod: str(r.kod), datum,
      castka: r.typPohybuK === 'typPohybu.vydej' ? -castka : castka,
      ucet: relCode(r.primUcet), popis: str(r.popis), firma: str(r.nazFirmy),
    })
  }
  return out
}

/** Číselník Flexi (kód + název). */
export async function fetchCiselnik(cfg: AbraConfig, druh: AbraCiselnikDruh): Promise<{ kod: string; nazev: string | null }[]> {
  const raw = await abraGetAll(cfg, druh, null, 'detail=custom:kod,nazev')
  return raw
    .map((r) => ({ kod: str(r.kod) ?? '', nazev: str(r.nazev) }))
    .filter((r) => r.kod !== '')
}

/** Odkaz na doklad ve Flexi (prohlížeč zobrazí HTML náhled dokladu). */
export function abraDokladUrl(cfg: Pick<AbraConfig, 'url' | 'firma'>, evidencePath: string | null, idDokl: number | null): string | null {
  if (!evidencePath || idDokl === null) return null
  return `${cfg.url}/c/${encodeURIComponent(cfg.firma)}/${evidencePath}/${idDokl}`
}
