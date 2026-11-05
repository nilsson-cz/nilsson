import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getChildrenForPotvrzeni } from '@/lib/potvrzeni-o-studiu/gather'
import { PLATNOST_DNI } from '@/lib/potvrzeni-o-studiu/overeni'

// app/portal/potvrzeni/page.tsx — Potvrzení o studiu (rodičovský portál)
// Rodič si kdykoli stáhne PDF potvrzení, že dítě je žákem školy. Prostý GET
// formulář na /portal/potvrzeni/pdf (bez klientského JS). Nabízí jen děti,
// u nichž je přihlášený zákonným zástupcem a které do školy chodí.

export const metadata = { title: 'Potvrzení o studiu — ZŠ Vilekula' }

const UCEL_NAVRHY = [
  'přídavek na dítě',
  'zdravotní pojišťovna',
  'zaměstnavatel (daňové zvýhodnění)',
  'úřad práce',
  'dopravní slevy',
]

export default async function PortalPotvrzeniPage() {
  const supabase = await createSupabaseServerClient()
  const children = await getChildrenForPotvrzeni(supabase)
  if (children === null) redirect('/portal/login?error=not_guardian')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-(--portal-text)">Potvrzení o studiu</h1>
        <p className="text-sm text-(--portal-text-subtle) mt-1">
          Kdykoli si stáhněte potvrzení, že vaše dítě je žákem naší školy — třeba pro úřad,
          zdravotní pojišťovnu nebo zaměstnavatele. Údaje se berou z aktuální školní matriky.
        </p>
      </div>

      {children.length === 0 ? (
        <div className="portal-card px-6 py-8 text-center text-(--portal-text-subtle)">
          Ve vašem profilu není evidováno žádné dítě, u kterého jste zákonným zástupcem.
          Kontaktujte prosím školu.
        </div>
      ) : (
        <form action="/portal/potvrzeni/pdf" method="GET" className="portal-card px-5 py-5 space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-(--portal-text) mb-2">Dítě</legend>
            {children.map((c, i) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-(--portal-text)">
                <input
                  type="radio"
                  name="student"
                  value={c.id}
                  defaultChecked={i === 0}
                  required
                  className="accent-(--portal-accent)"
                />
                {c.last_name} {c.first_name}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <label htmlFor="ucel" className="text-sm font-medium text-(--portal-text)">
              Účel potvrzení <span className="font-normal text-(--portal-text-subtle)">(nepovinné)</span>
            </label>
            <input
              id="ucel"
              name="ucel"
              type="text"
              maxLength={120}
              list="ucel-navrhy"
              placeholder="např. přídavek na dítě"
              className="w-full rounded-lg border border-(--portal-border) bg-(--portal-surface)
                px-3 py-2 text-sm text-(--portal-text) placeholder:text-(--portal-text-subtle)"
            />
            <datalist id="ucel-navrhy">
              {UCEL_NAVRHY.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <label className="flex items-start gap-2 text-sm text-(--portal-text)">
            <input type="checkbox" name="rc" value="1" className="mt-0.5 accent-(--portal-accent)" />
            <span>
              Uvést rodné číslo
              <span className="block text-xs text-(--portal-text-subtle)">
                Některé úřady ho vyžadují; jinak stačí datum narození.
              </span>
            </span>
          </label>

          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-(--portal-accent) px-4 py-2
              text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Stáhnout PDF
          </button>

          <p className="text-xs text-(--portal-text-subtle)">
            Potvrzení nese QR kód, kterým instituce ověří jeho pravost. Platí {PLATNOST_DNI} dní
            od vydání, pak si stáhněte nové. Nesedí-li některý údaj (třída, bydliště), dejte nám
            prosím vědět.
          </p>
        </form>
      )}
    </div>
  )
}
