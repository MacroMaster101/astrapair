import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicEnv } from "@/lib/env";
import {
  AFTER_SIGN_IN_PATH,
  getRouteAccess,
  safeNextPath,
  SIGN_IN_PATH,
} from "@/lib/auth/routes";

/**
 * Refreshes the Supabase session cookie on every request and performs
 * optimistic auth redirects. Pages still verify the user server-side.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  // supabase-js returns network failures as `{ data: null, error }`, which
  // reads as signed out below. If it throws instead, do the same rather than
  // turning an auth outage into a 500 on every page.
  let isSignedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    isSignedIn = Boolean(data?.claims?.sub);
  } catch (error) {
    console.error("Session check failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
  }
  const { pathname, search } = request.nextUrl;
  const access = getRouteAccess(pathname);

  if (access === "protected" && !isSignedIn) {
    const url = request.nextUrl.clone();
    url.pathname = SIGN_IN_PATH;
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithSession(url, response);
  }

  if (access === "guest-only" && isSignedIn) {
    // A signed-in visitor on /login or /signup carries on to where they were going.
    const requested = new URL(
      safeNextPath(request.nextUrl.searchParams.get("next")),
      request.nextUrl,
    );
    // URL parsing strips tabs and newlines, so re-check the origin.
    const target =
      requested.origin === request.nextUrl.origin
        ? requested
        : new URL(AFTER_SIGN_IN_PATH, request.nextUrl);
    return redirectWithSession(target, response);
  }

  return response;
}

/** Carry refreshed auth cookies and no-cache headers onto a redirect. */
function redirectWithSession(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(key);
    if (value) redirect.headers.set(key, value);
  }
  return redirect;
}
