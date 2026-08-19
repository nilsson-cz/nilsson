// lib/supabase-web.ts
// Izolovaný, bezstavový anon klient POUZE pro veřejnou zeď „Ze života školy".
// Nesahá na sdílený lib/supabase.ts ani lib/supabase-server.ts a nemá žádnou
// vazbu na staff session (žádné cookies). Volá jen web.* RPC, které mají
// GRANT EXECUTE pro roli anon.

import { createClient } from '@supabase/supabase-js'

export function createWebClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
