'use client'

// Spojení bloku s dalšími třídami (migrace 149) — sdílené pro šablonu,
// konkrétní týden i denní třídnici. Jeden blok, víc tříd; blok má vlastníka
// (třídu, ze které vznikl), ostatní jsou připojené. Vlastníka nelze odpojit.
// Má-li připojovaná třída ve stejné době vlastní blok, komponenta se zeptá,
// zda ho sloučit, nebo ponechat zvlášť.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  navrhSpojeniBloku, spojitBlok, rozpojitBlok,
  navrhSpojeniSablony, spojitSablonu, rozpojitSablonu,
  type KonfliktSpojeni,
} from '@/app/actions/rozvrh-spojeni'
import { casHM } from '@/lib/rozvrh-shared'

export type TridaOption = { id: string; name: string }

export default function SpojeniTrid({
  kind,
  id,
  currentGroupId,
  vlastnikGroupId,
  pripojeneIds,
  groups,
  potvrzeno = false,
  canWrite,
}: {
  kind: 'blok' | 'sablona'
  id: string
  currentGroupId: string
  vlastnikGroupId: string
  /** Připojené třídy (bez vlastníka). */
  pripojeneIds: string[]
  /** Třídy školního roku bloku. */
  groups: TridaOption[]
  potvrzeno?: boolean
  canWrite: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [vybrane, setVybrane] = useState<Set<string>>(() => new Set(pripojeneIds))
  const [konflikty, setKonflikty] = useState<KonfliktSpojeni[] | null>(null)
  const [sloucit, setSloucit] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const jmeno = (gid: string) => groups.find((g) => g.id === gid)?.name ?? '?'
  const spojeno = pripojeneIds.length > 0
  const jsemVlastnik = currentGroupId === vlastnikGroupId
  const nabidka = groups.filter((g) => g.id !== vlastnikGroupId)

  const reset = () => {
    setOpen(false); setVybrane(new Set(pripojeneIds)); setKonflikty(null); setSloucit(new Set()); setError(null)
  }

  const toggle = (gid: string) =>
    setVybrane((prev) => {
      const n = new Set(prev)
      if (n.has(gid)) n.delete(gid); else n.add(gid)
      return n
    })

  const pridat = [...vybrane].filter((g) => !pripojeneIds.includes(g))
  const odebrat = pripojeneIds.filter((g) => !vybrane.has(g))

  const provest = (slouceniIds: string[]) => {
    startTransition(async () => {
      const zpravy: string[] = []
      if (pridat.length > 0) {
        if (kind === 'blok') {
          const res = await spojitBlok({ blok_id: id, group_ids: pridat, slouceni_ids: slouceniIds })
          if (res.error) { setError(res.error); return }
        } else {
          const res = await spojitSablonu({ sablona_id: id, group_ids: pridat, slouceni_ids: slouceniIds })
          if (res.error) { setError(res.error); return }
          zpravy.push(`Připojeno ve ${res.pripojeno} vygenerovaných blocích, sloučeno ${res.slouceno}` +
            (res.ponechano ? `, ponecháno beze změny ${res.ponechano} (zapsané / uzamčený měsíc)` : '') + '.')
        }
      }
      for (const gid of odebrat) {
        if (kind === 'blok') {
          const res = await rozpojitBlok(id, gid)
          if (res.error) { setError(res.error); return }
        } else {
          const res = await rozpojitSablonu(id, gid)
          if (res.error) { setError(res.error); return }
          if (res.ponechano) zpravy.push(`Tř. ${jmeno(gid)}: ${res.ponechano} zapsaných/uzamčených bloků zůstává spojených.`)
        }
      }
      reset()
      setInfo(zpravy.length > 0 ? zpravy.join(' ') : null)
      router.refresh()
    })
  }

  const ulozit = () => {
    setError(null); setInfo(null)
    if (pridat.length === 0 && odebrat.length === 0) { reset(); return }

    if (odebrat.length > 0) {
      const tridy = odebrat.map((g) => `tř. ${jmeno(g)}`).join(', ')
      const text = kind === 'sablona'
        ? `Odpojit ${tridy}? Blok zmizí z její šablony i z budoucích nezapsaných týdnů.`
        : potvrzeno
          ? `Odpojit ${tridy}? Blok je zapsaný — odpojená třída o zápis přijde (zůstane jen tř. ${jmeno(vlastnikGroupId)}).`
          : `Odpojit ${tridy}?`
      if (!window.confirm(text)) return
    }

    if (pridat.length === 0) { provest([]); return }

    startTransition(async () => {
      const res = kind === 'blok' ? await navrhSpojeniBloku(id, pridat) : await navrhSpojeniSablony(id, pridat)
      if (res.error) { setError(res.error); return }
      const k = res.konflikty ?? []
      if (k.length === 0) { provest([]); return }
      // Zeptat se: výchozí volba = sloučit, kde to jde.
      setSloucit(new Set(k.filter((x) => x.lzeSloucit).map((x) => x.id)))
      setKonflikty(k)
    })
  }

  // --- Štítek (vidí každý) ---
  const stitek = spojeno && (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300">
      🔗 {jsemVlastnik
        ? `společně s tř. ${pripojeneIds.map(jmeno).join(', ')}`
        : `spojeno — blok tř. ${jmeno(vlastnikGroupId)}${pripojeneIds.length > 1 ? ` (+ ${pripojeneIds.filter((g) => g !== currentGroupId).map(jmeno).join(', ')})` : ''}`}
    </span>
  )

  if (!canWrite) return stitek ? <div className="mt-1.5">{stitek}</div> : null

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {stitek}
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setInfo(null) }} disabled={pending}
            className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-200">
            {spojeno ? 'Upravit spojení' : '+ Spojeno s další třídou'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-1.5 rounded-lg border border-violet-100 bg-violet-50/40 p-2.5 dark:border-violet-900 dark:bg-violet-950/20">
          {konflikty === null ? (
            <>
              <p className="text-xs text-gray-600 dark:text-stone-300">
                Spojeno s třídou (blok patří tř. {jmeno(vlastnikGroupId)}; zápis je společný):
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {nabidka.length === 0 && <span className="text-xs text-gray-400">Žádná další třída.</span>}
                {nabidka.map((g) => (
                  <label key={g.id} className="inline-flex items-center gap-1.5 text-sm text-gray-700 dark:text-stone-200">
                    <input type="checkbox" checked={vybrane.has(g.id)} onChange={() => toggle(g.id)} className="rounded border-gray-300" />
                    Tř. {g.name}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={ulozit} disabled={pending}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                  {pending ? 'Ukládám…' : 'Uložit spojení'}
                </button>
                <button type="button" onClick={reset} disabled={pending}
                  className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">Zrušit</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-gray-700 dark:text-stone-200">
                Připojované třídy mají ve stejné době vlastní blok — co s ním?
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {konflikty.map((k) => (
                  <li key={k.id} className="text-sm text-gray-700 dark:text-stone-200">
                    <span className="font-medium">Tř. {k.trida}</span>: „{k.nazev}“ {casHM(k.cas_od)}–{casHM(k.cas_do)}
                    <div className="mt-0.5 flex flex-wrap gap-x-4 text-xs">
                      <label className={`inline-flex items-center gap-1 ${k.lzeSloucit ? '' : 'opacity-40'}`}>
                        <input type="radio" name={`k-${k.id}`} disabled={!k.lzeSloucit} checked={sloucit.has(k.id)}
                          onChange={() => setSloucit((p) => new Set(p).add(k.id))} />
                        Sloučit {kind === 'sablona' ? '(jeho vyučující přejdou sem, blok skončí)' : '(vyučující a poznámky přejdou sem, blok zanikne)'}
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input type="radio" name={`k-${k.id}`} checked={!sloucit.has(k.id)}
                          onChange={() => setSloucit((p) => { const n = new Set(p); n.delete(k.id); return n })} />
                        Ponechat zvlášť
                      </label>
                      {!k.lzeSloucit && k.duvod && <span className="text-amber-600">nelze sloučit — {k.duvod}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => provest([...sloucit])} disabled={pending}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">
                  {pending ? 'Ukládám…' : 'Potvrdit spojení'}
                </button>
                <button type="button" onClick={() => setKonflikty(null)} disabled={pending}
                  className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">Zpět</button>
              </div>
            </>
          )}
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>
      )}
      {info && <p className="mt-1 text-xs text-gray-500 dark:text-stone-400">{info}</p>}
    </div>
  )
}
