import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { handleZivot } from "@/lib/zivot-gate"

export async function proxy(request: NextRequest) {
  // --- Web wall „Ze života školy" (izolovaná větev, viz lib/zivot-gate.ts) ---
  // Musí být PRVNÍ: pro /zivot se nikdy nevytváří staff Supabase klient ani
  // neběží staff auth logika níže.
  if (
    request.nextUrl.pathname === "/zivot" ||
    request.nextUrl.pathname.startsWith("/zivot/")
  ) {
    return handleZivot(request)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  supabaseResponse.headers.set("x-pathname", pathname)

  const isProtected =
    (pathname.startsWith("/dashboard") ||
     pathname.startsWith("/portal")) &&
    pathname !== "/portal/login" &&
    pathname !== "/login"

  if (isProtected && !user) {
    const loginUrl = pathname.startsWith("/portal")
      ? "/portal/login"
      : "/login"
    return NextResponse.redirect(new URL(loginUrl, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/auth/:path*",
    "/dashboard/:path*",
    "/portal/:path*",
    "/login",
    "/zivot",
    "/zivot/:path*",
  ],
}
