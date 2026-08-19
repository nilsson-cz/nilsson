import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()

  const referer = request.headers.get('referer') ?? ''
  const loginUrl = referer.includes('/portal') ? '/portal/login' : '/login'

  return NextResponse.redirect(
    new URL(loginUrl, process.env.NEXT_PUBLIC_APP_URL!)
  )
}
