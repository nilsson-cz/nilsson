import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import NovaZadostConfirm from './NovaZadostConfirm'
import type { EnrollmentTyp } from '@/lib/enrollment/types'

// app/zapis/nova/page.tsx — server wrapper.
// Ověří přihlášení a otevírací okno, pak předá klientské potvrzovací
// komponentě (založení až po kliknutí — refresh na GET nesmí vytvořit
// duplicitní žádost).

export const dynamic = 'force-dynamic'

export default async function NovaZadostPage({
  searchParams,
}: {
  searchParams: Promise<{ typ?: string }>
}) {
  const { typ: typParam } = await searchParams
  const typ: EnrollmentTyp = typParam === 'prestup' ? 'prestup' : 'zapis'

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/zapis/prihlaseni?next=${encodeURIComponent(`/zapis/nova?typ=${typ}`)}`)
  }

  // U zápisu ověřit otevírací okno (u přestupu se neomezuje)
  if (typ === 'zapis') {
    const { data: settings } = await supabase
      .from('enrollment_settings')
      .select('zapis_otevren')
      .eq('id', 1)
      .maybeSingle()
    if (!settings?.zapis_otevren) {
      redirect('/zapis')
    }
  }

  return <NovaZadostConfirm typ={typ} />
}
