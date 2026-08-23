import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import StudentQuestionnaireForm from './_components/StudentQuestionnaireForm'
import GuardianQuestionnaireForm from './_components/GuardianQuestionnaireForm'

// app/portal/dotaznik/page.tsx — Osobní dotazník (rodičovský portál)
// Přepínač dětí přes ?student=<id>. Část „o dítěti" per žák, část „o rodině"
// jednou pro přihlášeného rodiče (zobrazí se na kartách všech jeho dětí).
// Tabulky/RPC typované v types/database.ts (regenerováno po migraci 091).

export const metadata = { title: 'Osobní dotazník — ZŠ Vilekula' }

type Child = { id: string; first_name: string; last_name: string }

export default async function PortalDotaznikPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>
}) {
  const { student: studentParam } = await searchParams
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/portal/login')

  const { data: guardianRaw } = await supabase
    .from('guardians')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  const guardian = guardianRaw as any
  if (!guardian) redirect('/portal/login?error=not_guardian')

  // Děti (aktivní vazby)
  const { data: linksRaw } = await supabase
    .from('student_guardian_links')
    .select('students ( id, first_name, last_name )')
    .eq('guardian_id', guardian.id)
    .is('platnost_do', null)

  const children: Child[] = ((linksRaw as any[]) ?? [])
    .map((l) => l.students)
    .filter(Boolean)
    .sort((a: Child, b: Child) => a.last_name.localeCompare(b.last_name, 'cs'))

  // Guardian část (jednou pro rodiče)
  const { data: gqRaw } = await supabase
    .from('guardian_questionnaire')
    .select('*')
    .eq('guardian_id', guardian.id)
    .maybeSingle()

  if (children.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="portal-card px-6 py-8 text-center text-(--portal-text-subtle)">
          Ve vašem profilu nejsou evidovány žádné děti. Kontaktujte prosím průvodce.
        </div>
        <GuardianQuestionnaireForm initial={gqRaw ?? null} />
      </div>
    )
  }

  // Vybrané dítě
  const selectedId =
    studentParam && children.some((c) => c.id === studentParam)
      ? studentParam
      : children[0].id
  const selected = children.find((c) => c.id === selectedId)!

  // Dotazník vybraného dítěte
  const { data: sqRaw } = await supabase
    .from('student_questionnaire')
    .select('*')
    .eq('student_id', selectedId)
    .maybeSingle()

  // Sourozenci ve škole (odvození z grafu ZZ)
  const { data: siblingsRaw } = await supabase.rpc('get_in_school_siblings', {
    p_student_id: selectedId,
  })
  const siblings = (siblingsRaw as any[]) ?? []

  // Seed zdravotních polí ze Zápisu — jen když ještě není řádek dotazníku
  let seed: { zdravotni_omezeni: string | null; lekar: string | null } | null = null
  if (!sqRaw) {
    const { data: seedRaw } = await supabase.rpc('get_enrollment_health_seed', {
      p_student_id: selectedId,
    })
    seed = (seedRaw as any[])?.[0] ?? null
  }

  return (
    <div className="space-y-6">
      <Header />

      {/* Přepínač dětí */}
      {children.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {children.map((c) => {
            const active = c.id === selectedId
            return (
              <Link
                key={c.id}
                href={`/portal/dotaznik?student=${c.id}`}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-(--portal-accent) text-white'
                    : 'bg-(--portal-surface) text-(--portal-text-muted) border border-(--portal-border) hover:text-(--portal-text)'
                }`}
              >
                {c.last_name} {c.first_name}
              </Link>
            )
          })}
        </div>
      )}

      <StudentQuestionnaireForm
        key={selectedId}
        student={selected}
        initial={sqRaw ?? null}
        seed={seed}
        siblings={siblings}
      />

      <GuardianQuestionnaireForm initial={gqRaw ?? null} />
    </div>
  )
}

function Header() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-(--portal-text)">Osobní dotazník</h1>
      <p className="text-sm text-(--portal-text-subtle) mt-1">
        Údaje slouží výhradně třídnímu průvodci a školnímu poradenskému pracovišti
        k hladké adaptaci dítěte. Můžete je kdykoli upravit.
      </p>
    </div>
  )
}
