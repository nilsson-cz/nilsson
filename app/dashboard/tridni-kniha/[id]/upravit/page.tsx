// app/dashboard/tridni-kniha/[id]/upravit/page.tsx
// Server Component — načte záznam server-side, předá do Client EditForm

import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { EditForm } from './_components/EditForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UpravitZaznamPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: zaznam, error } = await supabase
    .from('tridni_kniha_zaznamy')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !zaznam) {
    notFound();
  }

  return <EditForm zaznam={zaznam as any} />;
}
