import { NextResponse, type NextRequest } from "next/server";
import { SIGN_IN_PATH } from "@/lib/auth/routes";
import { INVITE_NEXT_COOKIE } from "@/lib/partner/next-path";
import { createClient } from "@/lib/supabase/server";

// POST only, so a cross-site link or image cannot sign the user out.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL(SIGN_IN_PATH, request.url), {
    status: 303,
  });
  // Don't let one person's remembered invite carry over to the next on this browser.
  response.cookies.delete(INVITE_NEXT_COOKIE);
  return response;
}
