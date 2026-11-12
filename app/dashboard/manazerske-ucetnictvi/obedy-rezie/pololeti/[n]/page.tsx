/**
 * app/dashboard/manazerske-ucetnictvi/obedy-rezie/pololeti/[n]/page.tsx
 * Server Component — náhled a založení pololetních pohledávek doplatku režie obědů.
 * Pohledávky lze založit, až jsou všechny měsíce pololetí potvrzené (TRD §6.3).
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  mesicLabel, pololetiMesice, popisDavky, skolniRokMesice, souhrnPololeti, vychoziSplatnost,
} from '@/lib/manazerske-ucetnictvi/obedy-rezie'
import { BASE, directorClient } from '../../../_lib'
import { PololetiForm, type PololetiRadek } from '../../_components/RezieForms'

export const metadata = { title: 'Režie obědů za pololetí — Manažerské účetnictví — IS Nilsson' }
export const dynamic = 'force-dynamic'

const SKOLNI_ROK = /^\d{4}\/\d{4}$/

export default async function ReziePololetiPage({
  params, searchParams,
}: {
  params: Promise<{ n: string }>
  searchParams: Promise<{ rok?: string }>
}) {
  const { supabase, isDirector } = await directorClient()
  if (!isDirector) notFound()
  const { n } = await params
  if (n !== '1' && n !== '2') notFound()
  const pololeti = Number(n) as 1 | 2
  const sp = await searchParams
  const now = new Date()
  const rok = sp.rok && SKOLNI_ROK.test(sp.rok) ? sp.rok
    : skolniRokMesice(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const mesice = pololetiMesice(rok, pololeti)

  const [mes, zak, davkaRes] = await Promise.all([
    supabase.from('mu_obedy_rezie_mesic').select('period, potvrzeno_at').in('period', mesice),
    supabase.from('mu_obedy_rezie_zak').select('student_id, obedu, doplatek').in('period', mesice),
    supabase.from('mu_obedy_rezie_davka').select('id, ss_kod, due_date, created_at').eq('skolni_rok', rok).eq('pololeti', pololeti).maybeSingle(),
  ])
  if (mes.error) throw new Error(mes.error.message)
  const potvrzene = new Set((mes.data ?? []).filter((m) => m.potvrzeno_at).map((m) => m.period))
  const nepotvrzene = mesice.filter((m) => !potvrzene.has(m))
  const davka = davkaRes.data

  const souhrn = souhrnPololeti((zak.data ?? []).map((z) => ({ ...z, doplatek: Number(z.doplatek) })))
  const ids = souhrn.map((s) => s.student_id)
  const [stud, poh] = await Promise.all([
    ids.length ? supabase.from('students').select('id, first_name, last_name, withdrawal_date').in('id', ids) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; withdrawal_date: string | null }[] }),
    davka ? supabase.from('mu_obedy_rezie_pohledavka').select('student_id').eq('davka_id', davka.id) : Promise.resolve({ data: [] as { student_id: string }[] }),
  ])
  const sById = new Map((stud.data ?? []).map((s) => [s.id, s]))
  const zalozeno = new Set((poh.data ?? []).map((p) => p.student_id))
  const dnes = now.toISOString().slice(0, 10)
  const radky: PololetiRadek[] = souhrn.map((z) => {
    const s = sById.get(z.student_id)
    return {
      ...z,
      jmeno: s ? `${s.last_name} ${s.first_name}` : z.student_id,
      odesel: !!s?.withdrawal_date && s.withdrawal_date < dnes,
      zalozeno: zalozeno.has(z.student_id),
    }
  }).sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs'))
  const suma = radky.reduce((s, r) => s + r.castka, 0)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <Link href={`${BASE}/obedy-rezie?rok=${rok}`} className="text-sm text-gray-500 hover:text-gray-800 dark:text-stone-400">← Režie obědů</Link>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-stone-100">{popisDavky(rok, pololeti)}</h1>
        <p className="text-sm text-gray-500 dark:text-stone-400 mt-0.5">
          {radky.length} žáků · celkem {suma.toLocaleString('cs-CZ')} Kč · měsíce {mesicLabel(mesice[0])} – {mesicLabel(mesice[mesice.length - 1])}
        </p>
      </div>

      {davka && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          Dávka založena {new Date(davka.created_at).toLocaleDateString('cs-CZ')}, SS {davka.ss_kod}, splatnost {new Date(davka.due_date).toLocaleDateString('cs-CZ')}.{' '}
          <Link href={`/dashboard/platby/akce/${davka.ss_kod}`} className="underline">Bilance v Platbách →</Link>
        </p>
      )}
      {nepotvrzene.length > 0 && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Pohledávky půjde založit, až budou spočítané a potvrzené všechny měsíce pololetí. Chybí: {nepotvrzene.map(mesicLabel).join(', ')}.
          Níže je průběžný náhled z dosud spočítaných měsíců.
        </p>
      )}

      <PololetiForm skolniRok={rok} pololeti={pololeti} radky={radky}
        vychoziSplatnost={davka?.due_date ?? vychoziSplatnost(rok, pololeti)} lzeZalozit={nepotvrzene.length === 0} />

      <p className="text-xs text-gray-500 dark:text-stone-400">
        Pohledávky se zakládají v Platbách jako obědy (SS řady 10) bez e-mailu rodičům.
        Žák, který už pohledávku v dávce má, se při opakovaném založení přeskočí.
      </p>
    </div>
  )
}
