import { NextResponse } from "next/server";
import { getRelease } from "@/lib/monitoring";

// Read the release on each request rather than freezing it at build time.
export const dynamic = "force-dynamic";

// Liveness only: no secrets and no database call.
export async function GET() {
  return NextResponse.json(
    { status: "ok", release: getRelease() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
