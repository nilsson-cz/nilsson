// lib/zivot-gate.ts
// Brána veřejné zdi „Ze života školy" (/zivot). Izolovaná od staff auth —
// volá se z proxy.ts jako samostatná větev a nikdy se nedotýká staff klienta.
//
// Tok tokenu:
//   1. Odkaz z e-mailu:  /zivot?k=<token>  → hash → web.verify_access_token
//   2. Po ověření se nastaví httpOnly cookie zivot_sess=<token_id> a redirect
//      na čisté /zivot (token zmizí z URL, historie i referreru).
//   3. Další requesty:  cookie → web.access_token_valid(token_id) při KAŽDÉM
//      requestu (revokace je tak okamžitá).
//
// MANTINEL: verify_access_token vrací 0 řádků při neplatném tokenu. Prázdný /
// chybný výsledek se vždy ošetří DŘÍV, než se sáhne na .token_id / .school_year.
// Jakákoli chyba RPC = fail closed (redirect na vstupní stránku), nikdy 500.

import { NextResponse, type NextRequest } from 'next/server'
import { hashToken } from '@/lib/access-token'
import { createWebClient } from '@/lib/supabase-web'

const SESSION_COOKIE = 'zivot_sess'
const YEAR_COOKIE = 'zivot_year'
const GATE_PATH = '/zivot/vstup'

// ~ do konce školního roku; revokace je stejně vynucena serverově každý request.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400 // 400 dní (strop prohlížeče)

const baseCookie = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/zivot',
}

export async function handleZivot(request: NextRequest): Promise<NextResponse> {
  const { pathname, searchParams } = request.nextUrl

  // Vstupní stránka je vždy veřejná — jinak vznikne redirect loop.
  if (pathname === GATE_PATH) {
    return NextResponse.next()
  }

  const k = searchParams.get('k')

  // 1) Nový odkaz s tokenem v query
  if (k) {
    try {
      const hash = await hashToken(k)
      const supabase = createWebClient()
      const { data, error } = await supabase
        .schema('web')
        .rpc('verify_access_token', { p_hash: hash })

      // MANTINEL: prázdný / chybný výsledek ošetřit PŘED přístupem k .token_id
      const row = Array.isArray(data) ? data[0] : null
      if (error || !row) {
        return redirectToGate(request, 'invalid')
      }

      // Platný token → nastavit cookie a odstranit k z URL
      const res = NextResponse.redirect(new URL('/zivot', request.url))
      res.cookies.set(SESSION_COOKIE, row.token_id, {
        ...baseCookie,
        maxAge: COOKIE_MAX_AGE,
      })
      res.cookies.set(YEAR_COOKIE, row.school_year ?? '', {
        ...baseCookie,
        maxAge: COOKIE_MAX_AGE,
      })
      return res
    } catch {
      return redirectToGate(request, 'error')
    }
  }

  // 2) Bez k — zkusit existující cookie
  const tokenId = request.cookies.get(SESSION_COOKIE)?.value
  if (tokenId) {
    try {
      const supabase = createWebClient()
      const { data, error } = await supabase
        .schema('web')
        .rpc('access_token_valid', { p_id: tokenId })

      if (!error && data === true) {
        return NextResponse.next()
      }
      // Revokovaný / neplatný → smazat cookie a na vstupní stránku
      return clearAndGate(request)
    } catch {
      return redirectToGate(request, 'error')
    }
  }

  // 3) Bez k i bez cookie
  return redirectToGate(request)
}

function redirectToGate(request: NextRequest, error?: string): NextResponse {
  const url = new URL(GATE_PATH, request.url)
  if (error) url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

function clearAndGate(request: NextRequest): NextResponse {
  const res = redirectToGate(request)
  // Vyprázdnit se stejným path, aby se cookie spolehlivě smazala.
  res.cookies.set(SESSION_COOKIE, '', { ...baseCookie, maxAge: 0 })
  res.cookies.set(YEAR_COOKIE, '', { ...baseCookie, maxAge: 0 })
  return res
}
