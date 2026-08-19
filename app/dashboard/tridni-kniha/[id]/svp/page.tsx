// app/dashboard/tridni-kniha/[id]/svp/page.tsx
// Server Component — načte záznam, existující vazby a seznam výstupů

import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SvpEditForm } from './_components/SvpEditForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SvpEditPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  // Záznam třídní knihy
  const { data: zaznam, error: zaznamError } = await supabase
    .from('tridni_kniha_zaznamy')
    .select('id, nazev, datum, school_year')
    .eq('id', id)
    .single();

  if (zaznamError || !zaznam) notFound();

  // Existující vazby pro tento záznam (vč. AI návrhů)
  const { data: vazbyRaw } = await supabase
    .from('svp_vazby')
    .select('id, vystup_id, rocnik, zdroj, ai_jistota, ai_zduvodneni')
    .eq('zaznam_id', id);

  const vazby = (vazbyRaw ?? []) as {
    id: string;
    vystup_id: string;
    rocnik: number;
    zdroj: string;
    ai_jistota: number | null;
    ai_zduvodneni: string | null;
  }[];

  // Všechny aktivní výstupy ŠVP
  const { data: vystupy } = await supabase
    .from('svp_vystupy')
    .select('id, kod, rocnik, predmet, vystup_text')
    .eq('aktivni', true)
    .order('rocnik')
    .order('predmet')
    .order('kod');

  return (
    <SvpEditForm
      zaznam={zaznam as any}
      existingVazby={vazby}
      vystupy={(vystupy ?? []) as any}
    />
  );
}
