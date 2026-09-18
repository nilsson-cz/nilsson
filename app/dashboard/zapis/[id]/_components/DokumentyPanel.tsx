'use client'

import { useState } from 'react'
import type { DokumentNabidka, EnrollmentDokumentDruh } from '@/lib/enrollment/dokumenty'

const OSLOVENI_OPTIONS = ['Vážená paní ředitelko', 'Vážený pane řediteli']

export interface DokumentyPrefill {
  dosavadniSkola: string
  cilovySkolniRok: string
  datumNastupuText: string
  skolniRok: string
  zastaveniDuvod: 'zpetvzeti' | 'bezpredmetna'
}

// ── stažení souboru ──────────────────────────────────────────────────────

function stahnoutGet(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function stahnoutPost(url: string, payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    return (j as { error?: string } | null)?.error ?? 'Generování PDF selhalo.'
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'dokument.pdf'
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objUrl)
  return null
}

function url(applicationId: string, druh: EnrollmentDokumentDruh): string {
  return `/dashboard/zapis/${applicationId}/dokument/${druh}`
}

// ── společné prvky formuláře ──────────────────────────────────────────────

function Pole({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm text-gray-600">
      {label}
      {children}
    </label>
  )
}

const inputCls = 'mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm'

function SubmitPost({
  disabled,
  onClick,
}: {
  disabled?: boolean
  onClick: () => void | Promise<void>
}) {
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={async () => {
        setPending(true)
        try {
          await onClick()
        } finally {
          setPending(false)
        }
      }}
      className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
    >
      {pending ? 'Generuji…' : 'Stáhnout PDF'}
    </button>
  )
}

function Chyba({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {text}
    </div>
  )
}

// ── oznámení (GET, adresát) ───────────────────────────────────────────────

function OznameniRadek({
  applicationId,
  nabidka,
  prefillSkola,
}: {
  applicationId: string
  nabidka: DokumentNabidka
  prefillSkola: string
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [skola, setSkola] = useState(prefillSkola)
  const [reditel, setReditel] = useState('')
  const [osloveni, setOsloveni] = useState(OSLOVENI_OPTIONS[0])

  function stahnout() {
    const q = new URLSearchParams({ skola, reditel, osloveni })
    stahnoutGet(`${url(applicationId, nabidka.druh)}?${q.toString()}`)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Zadat adresáta →">
      <Pole label="Adresát — název a adresa školy">
        <textarea
          value={skola}
          onChange={(e) => setSkola(e.target.value)}
          rows={2}
          placeholder="Základní škola, Bílina, Aléská 270, okres Teplice, příspěvková organizace"
          className={inputCls}
        />
      </Pole>
      <div className="grid grid-cols-2 gap-3">
        <Pole label="Ředitel / ředitelka (jméno a funkce)">
          <input
            type="text"
            value={reditel}
            onChange={(e) => setReditel(e.target.value)}
            placeholder="Mgr. Dagmar Axamitová, ředitelka školy"
            className={inputCls}
          />
        </Pole>
        <Pole label="Oslovení">
          <select value={osloveni} onChange={(e) => setOsloveni(e.target.value)} className={inputCls}>
            {OSLOVENI_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Pole>
      </div>
      <button
        type="button"
        disabled={!skola.trim()}
        onClick={stahnout}
        className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
      >
        Stáhnout PDF
      </button>
    </Karta>
  )
}

// ── rozhodnutí o odkladu (POST) ───────────────────────────────────────────

function OdkladRadek({
  applicationId,
  nabidka,
  prefill,
}: {
  applicationId: string
  nabidka: DokumentNabidka
  prefill: DokumentyPrefill
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [oduvodneni, setOduvodneni] = useState('')
  const [cilovyRok, setCilovyRok] = useState(prefill.cilovySkolniRok)
  const [nastup, setNastup] = useState(prefill.datumNastupuText)
  const [prilohy, setPrilohy] = useState('')
  const [skartacni, setSkartacni] = useState('S-10 (uchování po dobu 10 let)')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      oduvodneni,
      cilovy_skolni_rok: cilovyRok,
      datum_nastupu_text: nastup,
      prilohy,
      skartacni_znak: skartacni,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <div className="grid grid-cols-2 gap-3">
        <Pole label="Cílový školní rok">
          <input type="text" value={cilovyRok} onChange={(e) => setCilovyRok(e.target.value)} placeholder="2027/2028" className={inputCls} />
        </Pole>
        <Pole label="Datum nástupu (text)">
          <input type="text" value={nastup} onChange={(e) => setNastup(e.target.value)} placeholder="1. září 2027" className={inputCls} />
        </Pole>
      </div>
      <Pole label="Odůvodnění (průběh řízení, skutková zjištění, právní hodnocení)">
        <textarea
          value={oduvodneni}
          onChange={(e) => setOduvodneni(e.target.value)}
          rows={6}
          placeholder="Prázdný řádek odděluje odstavce."
          className={inputCls}
        />
      </Pole>
      <Pole label="Přílohy správního spisu (jedna na řádek, nepovinné)">
        <textarea value={prilohy} onChange={(e) => setPrilohy(e.target.value)} rows={3} className={inputCls} />
      </Pole>
      <Pole label="Skartační znak">
        <input type="text" value={skartacni} onChange={(e) => setSkartacni(e.target.value)} className={inputCls} />
      </Pole>
      <Chyba text={chyba} />
      <SubmitPost disabled={!oduvodneni.trim() || !cilovyRok.trim()} onClick={stahnout} />
    </Karta>
  )
}

// ── rozhodnutí o přijetí (POST) ───────────────────────────────────────────

function PrijetiRadek({
  applicationId,
  nabidka,
  prefill,
}: {
  applicationId: string
  nabidka: DokumentNabidka
  prefill: DokumentyPrefill
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [skolniRok, setSkolniRok] = useState(prefill.skolniRok)
  const [oduvodneni, setOduvodneni] = useState('')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      skolni_rok: skolniRok,
      oduvodneni,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <Pole label="Školní rok">
        <input type="text" value={skolniRok} onChange={(e) => setSkolniRok(e.target.value)} placeholder="2026/2027" className={inputCls} />
      </Pole>
      <Pole label="Odůvodnění (nepovinné — při plném vyhovění lze vypustit, § 68/4 spr. řádu)">
        <textarea value={oduvodneni} onChange={(e) => setOduvodneni(e.target.value)} rows={3} className={inputCls} />
      </Pole>
      <p className="text-xs text-gray-400">
        Písemné rozhodnutí do spisu; přijatým se nedoručuje (oznamuje se zveřejněním seznamu, § 183/2).
      </p>
      <Chyba text={chyba} />
      <SubmitPost disabled={!skolniRok.trim()} onClick={stahnout} />
    </Karta>
  )
}

// ── rozhodnutí o nepřijetí (POST) ─────────────────────────────────────────

function NeprijetiRadek({
  applicationId,
  nabidka,
  prefill,
}: {
  applicationId: string
  nabidka: DokumentNabidka
  prefill: DokumentyPrefill
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [skolniRok, setSkolniRok] = useState(prefill.skolniRok)
  const [oduvodneni, setOduvodneni] = useState('')
  const [prilohy, setPrilohy] = useState('žádné')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      skolni_rok: skolniRok,
      oduvodneni,
      prilohy,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <Pole label="Školní rok">
        <input type="text" value={skolniRok} onChange={(e) => setSkolniRok(e.target.value)} placeholder="2026/2027" className={inputCls} />
      </Pole>
      <Pole label="Odůvodnění (podklady, kritéria, bodování, výsledek řízení)">
        <textarea
          value={oduvodneni}
          onChange={(e) => setOduvodneni(e.target.value)}
          rows={8}
          placeholder="Prázdný řádek odděluje odstavce."
          className={inputCls}
        />
      </Pole>
      <Pole label="Přílohy (jedna na řádek)">
        <textarea value={prilohy} onChange={(e) => setPrilohy(e.target.value)} rows={2} className={inputCls} />
      </Pole>
      <Chyba text={chyba} />
      <SubmitPost disabled={!oduvodneni.trim() || !skolniRok.trim()} onClick={stahnout} />
    </Karta>
  )
}

// ── usnesení o přerušení řízení (POST) ────────────────────────────────────

function PreruseniRadek({
  applicationId,
  nabidka,
}: {
  applicationId: string
  nabidka: DokumentNabidka
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [cisloJednaci, setCisloJednaci] = useState('')
  const [datumVydani, setDatumVydani] = useState('')
  const [datumZadosti, setDatumZadosti] = useState('')
  const [lhuta, setLhuta] = useState('30')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      cislo_jednaci: cisloJednaci,
      datum_vydani: datumVydani || undefined,
      datum_zadosti: datumZadosti || undefined,
      lhuta_dnu: Number(lhuta) || 30,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <div className="grid grid-cols-2 gap-3">
        <Pole label="Číslo jednací">
          <input type="text" value={cisloJednaci} onChange={(e) => setCisloJednaci(e.target.value)} placeholder="VIL/6/2026" className={inputCls} />
        </Pole>
        <Pole label="Datum vydání">
          <input type="date" value={datumVydani} onChange={(e) => setDatumVydani(e.target.value)} className={inputCls} />
        </Pole>
        <Pole label="Datum doručení žádosti">
          <input type="date" value={datumZadosti} onChange={(e) => setDatumZadosti(e.target.value)} className={inputCls} />
        </Pole>
        <Pole label="Lhůta k doplnění (dnů)">
          <input type="number" value={lhuta} min={1} onChange={(e) => setLhuta(e.target.value)} className={inputCls} />
        </Pole>
      </div>
      <Chyba text={chyba} />
      <SubmitPost disabled={!cisloJednaci.trim()} onClick={stahnout} />
    </Karta>
  )
}

// ── rozhodnutí o zamítnutí přestupu (POST) ────────────────────────────────

function PrestupZamitnutRadek({
  applicationId,
  nabidka,
}: {
  applicationId: string
  nabidka: DokumentNabidka
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [prestupKDatu, setPrestupKDatu] = useState('')
  const [oduvodneni, setOduvodneni] = useState('')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      prestup_k_datu: prestupKDatu,
      oduvodneni,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <Pole label="Přestup k datu (nepovinné, text)">
        <input type="text" value={prestupKDatu} onChange={(e) => setPrestupKDatu(e.target.value)} placeholder="1. 9. 2026" className={inputCls} />
      </Pole>
      <Pole label="Odůvodnění (typicky naplněná kapacita)">
        <textarea value={oduvodneni} onChange={(e) => setOduvodneni(e.target.value)} rows={5} placeholder="Prázdný řádek odděluje odstavce." className={inputCls} />
      </Pole>
      <Chyba text={chyba} />
      <SubmitPost disabled={!oduvodneni.trim()} onClick={stahnout} />
    </Karta>
  )
}

// ── usnesení o zastavení řízení (POST) ────────────────────────────────────

function ZastaveniRadek({
  applicationId,
  nabidka,
  prefill,
}: {
  applicationId: string
  nabidka: DokumentNabidka
  prefill: DokumentyPrefill
}) {
  const [otevreno, setOtevreno] = useState(false)
  const [duvod, setDuvod] = useState(prefill.zastaveniDuvod)
  const [datumUdalosti, setDatumUdalosti] = useState('')
  const [oduvodneni, setOduvodneni] = useState('')
  const [chyba, setChyba] = useState<string | null>(null)

  async function stahnout() {
    setChyba(null)
    const err = await stahnoutPost(url(applicationId, nabidka.druh), {
      duvod,
      datum_udalosti: datumUdalosti || undefined,
      oduvodneni,
    })
    if (err) setChyba(err)
  }

  return (
    <Karta label={nabidka.label} otevreno={otevreno} setOtevreno={setOtevreno} akce="Vyplnit →">
      <Pole label="Důvod zastavení">
        <select value={duvod} onChange={(e) => setDuvod(e.target.value as DokumentyPrefill['zastaveniDuvod'])} className={inputCls}>
          <option value="zpetvzeti">Zpětvzetí žádosti (§ 66/1/a) — storno rodičem</option>
          <option value="bezpredmetna">Zjevná bezpředmětnost (§ 66/1/g) — např. nedostavili se</option>
        </select>
      </Pole>
      {duvod === 'zpetvzeti' && (
        <Pole label="Datum zpětvzetí žádosti">
          <input type="date" value={datumUdalosti} onChange={(e) => setDatumUdalosti(e.target.value)} className={inputCls} />
        </Pole>
      )}
      <Pole label="Odůvodnění — doplnění okolností (nepovinné)">
        <textarea value={oduvodneni} onChange={(e) => setOduvodneni(e.target.value)} rows={3} placeholder="Konkrétní okolnosti (u bezpředmětnosti doporučeno doplnit)." className={inputCls} />
      </Pole>
      <Chyba text={chyba} />
      <SubmitPost onClick={stahnout} />
    </Karta>
  )
}

// ── společný obal karty (rozbalovací) ─────────────────────────────────────

function Karta({
  label,
  otevreno,
  setOtevreno,
  akce,
  children,
}: {
  label: string
  otevreno: boolean
  setOtevreno: (v: boolean) => void
  akce: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOtevreno(!otevreno)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
      >
        <span className="font-medium">{label}</span>
        <span className="text-gray-400">{otevreno ? 'Skrýt' : akce}</span>
      </button>
      {otevreno && <div className="space-y-3 border-t border-gray-100 p-3">{children}</div>}
    </div>
  )
}

// ── panel ─────────────────────────────────────────────────────────────────

export default function DokumentyPanel({
  applicationId,
  nabidka,
  prefill,
}: {
  applicationId: string
  nabidka: DokumentNabidka[]
  prefill: DokumentyPrefill
}) {
  if (nabidka.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">
        Dokumenty ke stažení
      </h2>

      <div className="space-y-2">
        {nabidka.map((n) => {
          switch (n.formular) {
            case 'adresat':
              return (
                <OznameniRadek
                  key={n.druh}
                  applicationId={applicationId}
                  nabidka={n}
                  prefillSkola={n.adresatKind === 'dosavadni' ? prefill.dosavadniSkola : ''}
                />
              )
            case 'prijeti':
              return <PrijetiRadek key={n.druh} applicationId={applicationId} nabidka={n} prefill={prefill} />
            case 'neprijeti':
              return <NeprijetiRadek key={n.druh} applicationId={applicationId} nabidka={n} prefill={prefill} />
            case 'odklad':
              return <OdkladRadek key={n.druh} applicationId={applicationId} nabidka={n} prefill={prefill} />
            case 'prestup_zamitnut':
              return <PrestupZamitnutRadek key={n.druh} applicationId={applicationId} nabidka={n} />
            case 'zastaveni':
              return <ZastaveniRadek key={n.druh} applicationId={applicationId} nabidka={n} prefill={prefill} />
            case 'preruseni':
              return <PreruseniRadek key={n.druh} applicationId={applicationId} nabidka={n} />
            default:
              return null
          }
        })}
      </div>
    </div>
  )
}
