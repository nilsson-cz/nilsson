// app/dashboard/tridni-kniha/novy/page.tsx
// Server Component — načte skupiny pro aktuální školní rok, předá do formuláře

import { createSupabaseServerClient } from '@/lib/supabase-server';
import { CURRENT_SCHOOL_YEAR } from '@/lib/config';
import { NovyZaznamForm } from './_components/NovyZaznamForm';

export default async function NovyZaznamPage() {
  const supabase = await createSupabaseServerClient();

  const { data: skupiny } = await supabase
    .from('groups')
    .select('id, name')
    .eq('school_year', CURRENT_SCHOOL_YEAR)
    .order('name');

  return (
    <NovyZaznamForm
      skupiny={(skupiny ?? []) as { id: string; name: string }[]}
      schoolYear={CURRENT_SCHOOL_YEAR}
    />
  );
}
