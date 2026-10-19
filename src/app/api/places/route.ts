import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getProfile, getUserId } from "@/lib/auth/session";
import {
  GeocodingUnavailableError,
  searchPlaces,
} from "@/lib/geocoding/places";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const querySchema = z.string().trim().min(2).max(100);

// The typed place is part of a person's birth details, so it travels in the
// request body: a query string would end up in hosting request logs.
const MAX_BODY_CHARS = 1_000;

async function readQuery(request: NextRequest): Promise<unknown> {
  // Refuse an oversized body before reading it, when the client says its size.
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_CHARS * 4) return "";
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return "";
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && "q" in body
      ? (body as { q: unknown }).q
      : "";
  } catch {
    return "";
  }
}

export function GET() {
  return NextResponse.json(
    { error: "Use POST to search places." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function POST(request: NextRequest) {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "Sign in to search places." },
      { status: 401 },
    );
  }

  const profile = await getProfile();
  if (!profile.onboarded_at) {
    return NextResponse.json(
      { error: "Finish setting up your account first." },
      { status: 403 },
    );
  }

  const parsed = querySchema.safeParse(await readQuery(request));
  if (!parsed.success) return NextResponse.json({ results: [] });

  if (!limiter.check(userId)) {
    return NextResponse.json(
      { error: "Too many searches. Wait a moment and try again." },
      { status: 429 },
    );
  }

  try {
    const results = await searchPlaces(parsed.data);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (!(e instanceof GeocodingUnavailableError)) throw e;
    return NextResponse.json(
      {
        error: "Place search isn't available right now. Try again in a minute.",
      },
      { status: 502 },
    );
  }
}
