import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
  * Refreshes the Supabase session cookie on every request and redirects
 * anonymous visitors away from the dashboard.
 *
 * This is defence in depth, not the security boundary: RLS in Postgres
 * is. A middleware bypass still cannot read another org's rows.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the JWT against Supabase — do not swap this for
  // getSession(), which trusts whatever cookie the browser presented.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /*
   * API routes authenticate themselves and answer with a JSON 401.
   * Redirecting them to /login would hand an API client an HTML login
   * page and a 307, which is useless to it — so the middleware only
   * refreshes the session cookie here and lets the handler decide.
   */
  if (pathname.startsWith("/api/")) {
    return response;
  }

  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
