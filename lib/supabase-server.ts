/**
 * lib/supabase-server.ts
 *
 * Server-side Supabase klient — používat v:
 *   - Route Handlers (app/api/**, app/auth/**)
 *   - Server Components
 *   - Server Actions
 *
 * POZOR: Nevolat z Client Components ('use client').
 * Pro Client Components použít stávající lib/supabase.ts (createBrowserClient).
 *
 * Architektura: cookies se čtou i zapisují přes next/headers — session tokeny
 * se tak automaticky refreshují a přenáší do RSC/Route Handlerů.
 * FORCE RLS platí i pro tyto requesty, protože klient používá anon key
 * a Supabase JWT obsahuje auth.uid() = staff.id.
 */

import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database' // vygenerovat: npx supabase gen types typescript

/**
 * Vytvoří server-side Supabase klienta s cookies z aktuálního requestu.
 *
 * Použití v Route Handler:
 *   const supabase = await createSupabaseServerClient()
 *   const { data: { user } } = await supabase.auth.getUser()
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // V Server Components nelze cookies nastavovat — ignorovat.
            // Middleware zajistí refresh session tokenů.
          }
        },
      },
    }
  )
}

/**
 * Vytvoří Supabase klienta se service role key — obchází RLS.
 * Používat POUZE v server-side kontextech bez uživatelské session:
 *   - Cron joby (fio-import, apod.)
 *   - Migrace / seed skripty
 * NIKDY neexponovat na klientovi.
 */
export function createSupabaseAdmin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
