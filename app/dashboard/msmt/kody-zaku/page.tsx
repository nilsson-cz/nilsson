import { createSupabaseServerClient } from '@/lib/supabase-server'
import { KodZakaMsmtRow } from './_components/KodZakaMsmtRow'

export const metadata = {
  title: 'Kódy žáků MŠMT | Nilsson',
}

export default async function KodyZakuPage() {
  const supabase = await createSupabaseServerClient()

  // Načteme všechny aktivní žáky seřazené dle kod_zaka
  const { data: students, error } = await supabase
    .from('students')
    .select('id, kod_zaka, first_name, last_name, birth_date, kod_zaka_msmt')
    .eq('status', 'active')
    .order('kod_zaka', { ascending: true })

  if (error) {
    return (
      <div className="p-6 text-red-600">
        Chyba při načítání žáků: {error.message}
      </div>
    )
  }

  const total = students?.length ?? 0
  const filled = students?.filter((s) => s.kod_zaka_msmt !== null).length ?? 0
  const missing = total - filled
  const progressPct = total > 0 ? Math.round((filled / total) * 100) : 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Nadpis */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Kódy žáků MŠMT
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Pole <code className="font-mono bg-gray-100 px-1 rounded">kod_zaka_msmt</code>{' '}
          = rodné číslo bez lomítka (10 číslic). Nutné před generováním MŠMT XML.
        </p>
      </div>

      {/* Progress */}
      <div className="mb-6 p-4 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Stav vyplnění
          </span>
          <span className="text-sm text-gray-500">
            {filled} / {total} žáků
            {missing > 0 && (
              <span className="ml-2 text-red-500 font-medium">
                ({missing} chybí)
              </span>
            )}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              progressPct === 100 ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {progressPct === 100 && (
          <p className="mt-2 text-xs text-green-600 font-medium">
            ✓ Všichni žáci mají vyplněný kód — MŠMT XML lze generovat.
          </p>
        )}
      </div>

      {/* Nápověda */}
      <div className="mb-4 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
        <strong>Jak zadat:</strong> Klikněte do pole a zadejte RČ — lomítko se auto-odstraní.
        Uložení proběhne po opuštění pole (blur) nebo stisku Enter. Esc = zrušit změnu.
      </div>

      {/* Tabulka */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Kód žáka
              </th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Jméno
              </th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Datum nar.
              </th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                KÓD MŠMT
              </th>
              <th className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Stav
              </th>
            </tr>
          </thead>
          <tbody>
            {students?.map((student) => (
              <KodZakaMsmtRow key={student.id} student={student} />
            ))}
            {(!students || students.length === 0) && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-gray-400"
                >
                  Žádní aktivní žáci nenalezeni.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Technická poznámka */}
      <p className="mt-4 text-xs text-gray-400">
        Kód se ukládá do <code className="font-mono">students.kod_zaka_msmt</code> (UNIQUE, max 10 znaků).
        Trigger <code className="font-mono">check_sma_msmt_kod</code> blokuje INSERT do{' '}
        <code className="font-mono">student_matrika_a</code> pokud je pole prázdné a <code className="font-mono">pspo &gt; 0</code>.
      </p>
    </div>
  )
}

