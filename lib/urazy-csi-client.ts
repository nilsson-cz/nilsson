/**
 * lib/urazy-csi-client.ts
 *
 * REST klient pro odesílání záznamů o úrazu do ČŠI / InspIS DATA (Fáze 2).
 * Server-only. Kontrakt ověřen proti testovacímu Swaggeru
 * `https://integration.csicr.cz/api/swagger/v1/swagger.json` (TRD Fáze 2).
 *
 * Tok odeslání záznamu (submitZaznam):
 *   1. POST /Login?login&password                → Bearer JWT (holé tělo)
 *   2. POST /Events/CreateInline (body [200129]) → a01ID (v poli `message`)
 *   3. GET  /Events/Get                          → a03ID, b02ID
 *   4. GET  /Events/GetListEventForm             → a11ID (pole `pid`)
 *   5. POST /Forms/SaveAnswers (body = odpovědi) → uložení
 *   6. GET  /Events/RunWorkflowStep (b06ID=359)  → posun do stavu PŘIJATO
 *
 * Tajemství se čtou z env (nikdy do gitu): INSPIS_LOGIN, INSPIS_PASSWORD,
 * INSPIS_HASH_KEY, INSPIS_API_BASE; REDIZO/IZO z INSPIS_REDIZO/INSPIS_IZO
 * (fallback na existující SCHOOL_RED_IZO / MSMT_IZO).
 */

import 'server-only'
import {
  type CsiAnswer,
  CSI_FORM_TYP,
  CSI_A10ID,
  CSI_A08ID,
  CSI_B06_ODESLANI,
  CSI_B06_ODESLAT_AKTUALIZACI,
  CSI_B06_ZADOST_ODEMKNUTI,
} from './urazy-csi'

export interface CsiClientConfig {
  base: string
  login: string
  password: string
  hashKey: string
  redizo: string
  izo: string
}

/** Načte konfiguraci z env; vyhodí s výčtem chybějících proměnných. */
export function loadCsiConfig(): CsiClientConfig {
  const base = (process.env.INSPIS_API_BASE ?? 'https://integration.csicr.cz/api').replace(/\/+$/, '')
  const login = process.env.INSPIS_LOGIN ?? ''
  const password = process.env.INSPIS_PASSWORD ?? ''
  const hashKey = process.env.INSPIS_HASH_KEY ?? ''
  const redizo = process.env.INSPIS_REDIZO ?? process.env.SCHOOL_RED_IZO ?? ''
  const izo = process.env.INSPIS_IZO ?? process.env.MSMT_IZO ?? ''

  const missing = Object.entries({ INSPIS_LOGIN: login, INSPIS_PASSWORD: password, INSPIS_HASH_KEY: hashKey, REDIZO: redizo, IZO: izo })
    .filter(([, v]) => !v)
    .map(([k]) => k)
  if (missing.length) {
    throw new Error(`urazy-csi-client: chybí konfigurace v env: ${missing.join(', ')}`)
  }
  return { base, login, password, hashKey, redizo, izo }
}

// --- odpovědní typy (jen pole, která používáme) ---
interface Result {
  success: boolean
  message: string | null
}
interface A01Event {
  a01ID?: number
  a03ID: number
  b02ID: number
  b02Name?: string
}
interface A11EventForm {
  pid: number
  a01ID?: number
}

export interface CsiSubmitResult {
  a01ID: number
  a03ID: number
  a11ID: number
  b02ID: number
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  return sp.toString()
}

export class CsiUrazApiClient {
  private token: string | null = null
  constructor(private cfg: CsiClientConfig = loadCsiConfig()) {}

  /** Přihlášení → Bearer token (cache v instanci). */
  async login(): Promise<string> {
    if (this.token) return this.token
    const url = `${this.cfg.base}/Login?${qs({ login: this.cfg.login, password: this.cfg.password })}`
    const res = await fetch(url, { method: 'POST', headers: { accept: 'text/plain' } })
    const body = (await res.text()).trim()
    if (!res.ok || !body) {
      throw new Error(`ČŠI /Login selhalo (HTTP ${res.status}): ${body.slice(0, 200)}`)
    }
    this.token = body
    return body
  }

  private async authed<T>(
    path: string,
    opts: { method: 'GET' | 'POST'; query?: Record<string, string | number | undefined>; body?: unknown; text?: boolean } = { method: 'GET' },
  ): Promise<T> {
    const token = await this.login()
    const url = `${this.cfg.base}${path}${opts.query ? `?${qs(opts.query)}` : ''}`
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${token}`,
        accept: opts.text ? 'text/plain' : 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    const raw = await res.text()
    if (!res.ok) {
      throw new Error(`ČŠI ${path} selhalo (HTTP ${res.status}): ${raw.slice(0, 300)}`)
    }
    return (raw ? JSON.parse(raw) : null) as T
  }

  /** Health check testovacího rozhraní (nepotřebuje token). */
  async ping(): Promise<boolean> {
    const res = await fetch(`${this.cfg.base}/Anonym/Ping`, { headers: { accept: 'text/plain' } })
    return res.ok
  }

  /** Krok 2: vytvoří akci s připojeným formulářem úrazu → a01ID. */
  async createEvent(): Promise<number> {
    const r = await this.authed<Result>('/Events/CreateInline', {
      method: 'POST',
      query: { HashIsKey: this.cfg.hashKey, a10ID: CSI_A10ID, a08ID: CSI_A08ID, REDIZO: this.cfg.redizo, IZO: this.cfg.izo },
      body: [CSI_FORM_TYP],
    })
    const a01ID = Number(r?.message)
    if (!r?.success || !Number.isFinite(a01ID)) {
      throw new Error(`ČŠI CreateInline neúspěch: ${JSON.stringify(r)}`)
    }
    return a01ID
  }

  /** Krok 3: instance akce → a03ID, b02ID. Events/Get vrací jeden objekt (ne pole). */
  async getEvent(a01ID: number): Promise<A01Event> {
    const res = await this.authed<A01Event | A01Event[]>('/Events/Get', {
      method: 'GET',
      query: { HashIsKey: this.cfg.hashKey, a01ID },
    })
    const ev = Array.isArray(res) ? res[0] : res
    if (!ev || ev.a03ID == null) throw new Error(`ČŠI Events/Get: neočekávaná odpověď pro a01ID=${a01ID}`)
    return ev
  }

  /** Krok 4: ID připojeného formuláře (a11ID = pole `pid`). */
  async getFormId(a01ID: number, a03ID: number): Promise<number> {
    const arr = await this.authed<A11EventForm[]>('/Events/GetListEventForm', {
      method: 'GET',
      query: { HashIsKey: this.cfg.hashKey, f06ID: CSI_FORM_TYP, a01ID, a03ID },
    })
    const a11ID = arr?.[0]?.pid
    if (!a11ID) throw new Error(`ČŠI GetListEventForm: nenalezen formulář pro a01ID=${a01ID}`)
    return a11ID
  }

  /** Krok 5: uložení odpovědí. Vrací Result — 200 i při success:false. */
  async saveAnswers(a11ID: number, answers: CsiAnswer[]): Promise<void> {
    const r = await this.authed<Result>('/Forms/SaveAnswers', {
      method: 'POST',
      query: { HashIsKey: this.cfg.hashKey, a11ID },
      body: answers,
    })
    if (r && r.success === false) {
      throw new Error(`ČŠI SaveAnswers neúspěch: ${r.message ?? ''}`)
    }
  }

  /**
   * Krok 6 (obecně): posun workflow. Endpoint vrací Result i s HTTP 200, takže
   * úspěch se pozná až z `success` (např. chybějící oprávnění ke kroku → false).
   */
  async runWorkflowStep(a01ID: number, b06ID: number, comment?: string): Promise<void> {
    const r = await this.authed<Result>('/Events/RunWorkflowStep', {
      method: 'GET',
      query: { HashIsKey: this.cfg.hashKey, a01ID, b06ID, comment },
    })
    if (r && r.success === false) {
      throw new Error(`ČŠI RunWorkflowStep [${b06ID}] neúspěch: ${r.message ?? ''}`)
    }
  }

  /**
   * Celý happy-path: vytvoří akci, uloží odpovědi a odešle (b06=359 → PŘIJATO).
   * Vrací identifikátory pro uložení k záznamu.
   */
  async submitZaznam(answers: CsiAnswer[], comment?: string): Promise<CsiSubmitResult> {
    const a01ID = await this.createEvent()
    const ev = await this.getEvent(a01ID)
    const a11ID = await this.getFormId(a01ID, ev.a03ID)
    await this.saveAnswers(a11ID, answers)
    await this.runWorkflowStep(a01ID, CSI_B06_ODESLANI, comment)
    return { a01ID, a03ID: ev.a03ID, a11ID, b02ID: ev.b02ID }
  }

  /** Odeslání aktualizace k již odeslanému záznamu (b06=365). */
  async submitAktualizace(a01ID: number, a11ID: number, answers: CsiAnswer[], comment?: string): Promise<void> {
    await this.saveAnswers(a11ID, answers)
    await this.runWorkflowStep(a01ID, CSI_B06_ODESLAT_AKTUALIZACI, comment)
  }

  /** Žádost o odemknutí odeslaného záznamu (b06=364). */
  async requestUnlock(a01ID: number, comment: string): Promise<void> {
    await this.runWorkflowStep(a01ID, CSI_B06_ZADOST_ODEMKNUTI, comment)
  }
}
