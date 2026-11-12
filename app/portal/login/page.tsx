/**
 * app/portal/login/page.tsx
 * Jednotné přihlášení: rodičovský portál už nemá vlastní přihlašovací stránku.
 * Stará adresa (odkazy v e-mailech, záložky, PWA) přesměruje na /login
 * s next=/portal; chybový kód (např. not_guardian) se předá dál.
 */

import { redirect } from 'next/navigation'

export default async function PortalLoginRedirect({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const sp = await searchParams
  const q = new URLSearchParams({ next: sp.next?.startsWith('/portal') ? sp.next : '/portal' })
  if (sp.error) q.set('error', sp.error)
  redirect(`/login?${q.toString()}`)
}
