'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDoporuceni } from '@/app/actions/vp-doporuceni'
import { parseSpzXml } from '@/lib/spz-xml'
import {
  INDI_LABEL, STAV_LABEL, ZDROJ_LABEL, druhLabel, emptyDoporuceni, jePoProSouborB,
} from '@/lib/vp-doporuceni-shared'
import type { Doporuceni } from '@/lib/vp-doporuceni-shared'
import { DoporuceniForm } from './DoporuceniForm'

interface Props {
  careId:     string
  studentId:  string
  student:    { first_name: string; last_name: string; birth_date: string | null }
  doporuceni: Doporuceni[]
  isDirector: boolean
}

function datum(v: string | null): string {
  return v ? new Date(`${v}T00:00:00`).toLocaleDateString('cs-CZ') : '—'
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** XML ze ŠPZ bývá UTF-8, ale respektujeme i kódování z hlavičky (např. windows-1250). */
async function precistSoubor(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hlava = new TextDecoder('ascii').decode(buf.slice(0, 200))
  const enc = hlava.match(/encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? 'utf-8'
  try {
    return new TextDecoder(enc).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

export function DoporuceniSekce({ careId, studentId, student, doporuceni, isDirector }: Props) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<{ data: Doporuceni; upozorneni: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function novyRucne() {
    setError(null)
    setForm({ data: { ...emptyDoporuceni(), student_id: studentId, care_id: careId }, upozorneni: [] })
  }

  async function nahratXml(file: File) {
    setError(null)
    try {
      const r = parseSpzXml(await precistSoubor(file))
      const upozorneni = [...r.upozorneni]
      const jmenoSedi = norm(r.klient.prijmeni) === norm(student.last_name) && norm(r.klient.jmeno) === norm(student.first_name)
      const dnSedi = !r.klient.datum_narozeni || !student.birth_date || r.klient.datum_narozeni === student.birth_date
      if (!jmenoSedi || !dnSedi) {
        upozorneni.unshift(
          `Doporučení je vystavené na „${r.klient.jmeno} ${r.klient.prijmeni}“${r.klient.datum_narozeni ? `, nar. ${datum(r.klient.datum_narozeni)}` : ''} — ` +
          `neodpovídá žákovi ${student.first_name} ${student.last_name}. Ověřte, že nahráváte správný soubor.`,
        )
      }
      setForm({ data: { ...r.doporuceni, student_id: studentId, care_id: careId }, upozorneni })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function smazat(id: string) {
    if (!confirm('Opravdu smazat doporučení včetně podpůrných opatření? Stupeň PO u péče se přepočítá.')) return
    startTransition(async () => {
      const r = await deleteDoporuceni(id)
      if (r.success) router.refresh()
      else setError(r.error)
    })
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Doporučení ŠPZ</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Zdroj pro matriku MŠMT (soubory „a“ a „b“). Stupeň PO a platnost péče se řídí doporučením.
          </p>
        </div>
        {!form && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void nahratXml(f) }} />
            <button type="button" onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600">
              Nahrát XML doporučení
            </button>
            <button type="button" onClick={novyRucne}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Zadat ručně
            </button>
          </div>
        )}
      </div>

      {!form && (
        <p className="text-xs text-gray-400">
          XML se čte jen ve vašem prohlížeči a neukládá se — IS si vezme pouze údaje pro matriku.
          Originál doporučení patří do citlivé složky na Drive.
        </p>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {form && (
        <DoporuceniForm
          key={form.data.id ?? 'nove'}
          initial={form.data}
          upozorneni={form.upozorneni}
          onClose={() => setForm(null)}
        />
      )}

      {doporuceni.length === 0 && !form && (
        <p className="text-sm text-gray-500">Žádné doporučení není zadané.</p>
      )}

      {doporuceni.map((d) => (
        <div key={d.id} className={`rounded-lg border p-4 space-y-3 ${d.stav === 'platne' ? 'border-orange-200' : 'border-gray-200 bg-gray-50/60'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">PO {d.pspo}. stupně</span>
                {d.id_znev && <span className="font-mono text-sm text-gray-700">{d.id_znev}{d.id_znev_dalsi ?? ''}</span>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  d.stav === 'platne' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>{STAV_LABEL[d.stav]}</span>
              </div>
              <p className="text-xs text-gray-600">
                Platnost {datum(d.platnost_od)} – {datum(d.ukonceno_k ?? d.platnost_do)}
                {' · '}vydáno {datum(d.datum_vydani)}
                {d.izo_spz && <> · IZO poradny {d.izo_spz}</>}
                {d.cislo_jednaci && <> · č. j. {d.cislo_jednaci}</>}
              </p>
              <p className="text-xs text-gray-500">
                {INDI_LABEL[d.indi]}
                {d.upr_vyst && ' · upravené výstupy'}
                {d.prodl_dv > 0 && ` · prodloužení o ${d.prodl_dv} r.`}
                {d.termin_kontroly && ` · kontrola ${datum(d.termin_kontroly)}`}
                {' · '}{ZDROJ_LABEL[d.zdroj]}
              </p>
              {(!d.izo_spz || !d.datum_vydani) && d.pspo >= 2 && (
                <p className="text-xs text-amber-700">Chybí IZO poradny nebo datum vydání — pro soubor „b“ je doplňte.</p>
              )}
            </div>
            {!form && (
              <div className="flex gap-3 text-sm">
                <button type="button" onClick={() => { setError(null); setForm({ data: d, upozorneni: [] }) }}
                  className="text-orange-600 hover:text-orange-800">Upravit</button>
                {isDirector && (
                  <button type="button" onClick={() => smazat(d.id!)} disabled={isPending}
                    className="text-red-600 hover:text-red-800 disabled:opacity-50">Smazat</button>
                )}
              </div>
            )}
          </div>

          {d.opatreni.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-1 pr-3 font-medium">Opatření</th>
                    <th className="py-1 pr-3 font-medium">Kód NFN</th>
                    <th className="py-1 pr-3 font-medium">Financování</th>
                    <th className="py-1 pr-3 font-medium">Doporučeno</th>
                    <th className="py-1 pr-3 font-medium">Poskytováno</th>
                  </tr>
                </thead>
                <tbody>
                  {d.opatreni.map((po) => (
                    <tr key={po.id} className="border-b border-gray-50 text-gray-700">
                      <td className="py-1 pr-3">
                        {druhLabel(po.druh)}
                        {po.pocet_jednotek != null && <span className="text-gray-400"> · {po.pocet_jednotek} j.</span>}
                      </td>
                      <td className="py-1 pr-3 font-mono">
                        {po.kod_nfn ?? '—'}
                        {po.kod_nfn && !jePoProSouborB(po) && <span className="ml-1 text-gray-400">(ŠZ)</span>}
                      </td>
                      <td className="py-1 pr-3">
                        {po.zdroj_financovani ?? '—'} · FN {po.fn}
                      </td>
                      <td className="py-1 pr-3">{datum(po.datum_zahajeni)} – {datum(po.datum_ukonceni)}</td>
                      <td className="py-1 pr-3">
                        {po.poskytovano_od
                          ? <>{datum(po.poskytovano_od)} – {po.poskytovano_do ? datum(po.poskytovano_do) : 'dosud'}</>
                          : <span className="text-amber-700">nezahájeno</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
