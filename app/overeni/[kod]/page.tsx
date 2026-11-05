// app/overeni/[kod]/page.tsx — veřejné ověření konkrétního potvrzení o studiu.
// Bez přihlášení. Čte evidenci (migrace 170) service-role klientem jen podle
// neuhodnutelného kódu a ukáže snapshot údajů, které škola vydala, + stav.

import { normalizeKod, najdiPotvrzeni, type OvereniStav } from '@/lib/potvrzeni-o-studiu/overeni'
import { OvereniShell, KodForm } from '../_components/OvereniShell'

export const metadata = { title: 'Ověření potvrzení o studiu', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'Europe/Prague' })
}

const STAV: Record<OvereniStav, { label: string; text: string; cls: string }> = {
  platne: {
    label: 'Potvrzení je pravé a platné',
    text: 'Škola toto potvrzení vydala. Porovnejte prosím údaje níže s předloženým dokumentem.',
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  },
  prosle: {
    label: 'Potvrzení je pravé, ale jeho platnost vypršela',
    text: 'Škola toto potvrzení vydala, údaje však nemusí odpovídat současnému stavu. Vyžádejte si aktuální potvrzení.',
    cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  zneplatnene: {
    label: 'Potvrzení bylo zneplatněno',
    text: 'Škola toto potvrzení zneplatnila. Nepovažujte ho za platné.',
    cls: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  },
}

function Radek({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-stone-100 dark:border-stone-800 last:border-b-0">
      <dt className="text-sm text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="text-sm text-right text-stone-900 dark:text-stone-100">{value}</dd>
    </div>
  )
}

export default async function OvereniKodPage({ params }: { params: Promise<{ kod: string }> }) {
  const { kod: raw } = await params
  const kod = normalizeKod(decodeURIComponent(raw))
  const z = kod ? await najdiPotvrzeni(kod) : null

  if (!z) {
    return (
      <OvereniShell>
        <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950 p-5 space-y-1">
          <p className="font-medium text-red-900 dark:text-red-200">Potvrzení s tímto kódem neexistuje</p>
          <p className="text-sm text-red-800 dark:text-red-300">
            Zkontrolujte opsaný kód. Pokud sedí, dokument nevydala tato škola.
          </p>
        </div>
        <KodForm />
      </OvereniShell>
    )
  }

  const stav = STAV[z.stav]
  const tridaRocnik = [z.rocnik ? `${z.rocnik}. ročník` : null, z.trida ? `třída ${z.trida}` : null]
    .filter(Boolean)
    .join(', ')

  return (
    <OvereniShell>
      <div className={`rounded-xl border p-5 space-y-1 ${stav.cls}`}>
        <p className="font-medium">{stav.label}</p>
        <p className="text-sm opacity-90">{stav.text}</p>
        {z.stav === 'zneplatnene' && z.zneplatneno_duvod && (
          <p className="text-sm opacity-90">Důvod: {z.zneplatneno_duvod}</p>
        )}
      </div>

      <dl className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-3">
        <Radek label="Žák/žákyně" value={z.jmeno_zaka} />
        <Radek label="Datum narození" value={fmt(z.datum_narozeni)} />
        <Radek label="Školní rok" value={z.skolni_rok} />
        {tridaRocnik && <Radek label="Ročník / třída" value={tridaRocnik} />}
        <Radek label="Vydáno" value={fmt(z.vydano_at)} />
        <Radek label="Platné do" value={fmt(z.plati_do)} />
        <Radek label="Ověřovací kód" value={z.kod} />
      </dl>
    </OvereniShell>
  )
}
