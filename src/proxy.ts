import type { NextRequest } from "next/server";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

// Behind a TLS-terminating host the app sees http, so trust the first
// x-forwarded-proto value too.
function isHttpsRequest(request: NextRequest) {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase();
  return forwarded === "https" || request.nextUrl.protocol === "https:";
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    isHttps: isHttpsRequest(request),
    // NEXT_PUBLIC_* vars must be referenced literally so Next.js can inline them.
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });

  // Set on the request itself (overwriting anything the client sent) before
  // updateSession builds its responses from it: Next.js reads the nonce from
  // the request's Content-Security-Policy header to stamp its own scripts, and
  // the root layout reads `x-nonce` for next-themes.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  const response = await updateSession(request);
  // Also on redirects, which updateSession builds as separate responses.
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip only real static locations, never by file extension: a path such as
    // /invite/x.png is an app page and must get the CSP. Skipped: build output,
    // image optimization, the metadata files in src/app (favicon.ico, icon.png,
    // apple-icon.png), the health check (it must not depend on Supabase env or
    // session refresh) and the folders under public/. A new folder under
    // public/ (or a new root metadata file) must be added here, or its files
    // will run through the proxy.
    "/((?!_next/static|_next/image|favicon\\.ico$|icon\\.png$|apple-icon\\.png$|api/health$|brand/|images/|animations/).*)",
  ],
};
