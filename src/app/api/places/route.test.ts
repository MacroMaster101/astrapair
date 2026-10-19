import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fake = vi.hoisted(() => ({
  userId: null as string | null,
  onboardedAt: "2026-09-01T00:00:00Z" as string | null,
}));

vi.mock("@/lib/auth/session", () => ({
  getUserId: async () => fake.userId,
  getProfile: async () => ({
    id: fake.userId,
    display_name: "Test",
    onboarded_at: fake.onboardedAt,
  }),
}));

import { GET, POST } from "./route";

const photonBody = {
  features: [
    {
      geometry: { coordinates: [79.8478, 6.9319] },
      properties: {
        osm_type: "N",
        osm_id: 1,
        osm_value: "city",
        name: "Colombo",
        country: "Sri Lanka",
      },
    },
  ],
};

const openMeteoBody = {
  results: [
    {
      id: 1248991,
      name: "Colombo",
      admin1: "Western Province",
      country: "Sri Lanka",
      latitude: 6.9319,
      longitude: 79.8478,
      timezone: "Asia/Colombo",
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** Answers each provider by hostname, so the route runs the real search code. */
function providers(photon: () => Response, openMeteo: () => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      const host = new URL(String(input)).hostname;
      calls.push(host);
      if (host === "photon.komoot.io") return photon();
      if (host === "geocoding-api.open-meteo.com") return openMeteo();
      throw new Error(`Unexpected request to ${host}`);
    }),
  );
  return calls;
}

const request = (q?: string) =>
  new NextRequest("http://localhost/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(q === undefined ? {} : { q }),
  });

const rawRequest = (body: string) =>
  new NextRequest("http://localhost/api/places", { method: "POST", body });

// The limiter is module state, so each test signs in as a new user.
let n = 0;
beforeEach(() => {
  n += 1;
  fake.userId = `user-${n}`;
  fake.onboardedAt = "2026-09-01T00:00:00Z";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/places access", () => {
  it("answers 401 for a visitor who is signed out, before any search", async () => {
    fake.userId = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 403 until onboarding is finished, before any search", async () => {
    fake.onboardedAt = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an empty list for a query that is too short or missing, without searching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const q of [undefined, "", " a "]) {
      const res = await POST(request(q));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 405 to GET, so a place can never be sent in a URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an empty list for a body that is not usable, without searching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    for (const body of [
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ q: 5 }),
      JSON.stringify({ q: "x".repeat(101) }),
      JSON.stringify({ q: "Colombo", pad: "x".repeat(2_000) }),
    ]) {
      const res = await POST(rawRequest(body));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ results: [] });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a declared oversized body without reading it", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const request = new NextRequest("http://localhost/api/places", {
      method: "POST",
      headers: { "content-length": "1000000" },
      body: JSON.stringify({ q: "Colombo" }),
    });
    const read = vi.spyOn(request, "text");
    const res = await POST(request);
    expect(await res.json()).toEqual({ results: [] });
    expect(read).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows 30 searches a minute per user and then answers 429", async () => {
    providers(
      () => json(photonBody),
      () => json(openMeteoBody),
    );
    for (let i = 0; i < 30; i++) {
      expect((await POST(request("Colombo"))).status).toBe(200);
    }
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(
      "Too many searches. Wait a moment and try again.",
    );
  });
});

describe("POST /api/places when a place service fails", () => {
  it("serves Photon's answer and does not call Open-Meteo when Photon works", async () => {
    const calls = providers(
      () => json(photonBody),
      () => json(openMeteoBody),
    );
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { id: string }) => r.id)).toEqual(["osm:N1"]);
    expect(calls).toEqual(["photon.komoot.io"]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("falls back to Open-Meteo when Photon is down", async () => {
    const calls = providers(
      () => json({}, 503),
      () => json(openMeteoBody),
    );
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([
      "om:1248991",
    ]);
    expect(calls).toEqual(["photon.komoot.io", "geocoding-api.open-meteo.com"]);
  });

  it("returns an empty list, not an error, when Photon finds nothing and Open-Meteo is down", async () => {
    providers(
      () => json({ features: [] }),
      () => json({}, 500),
    );
    const res = await POST(request("Nowhereville"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  it("answers 502 with friendly copy, and does not cache it, when both services are down", async () => {
    providers(
      () => json({}, 503),
      () => json({}, 500),
    );
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Place search isn't available right now. Try again in a minute.",
    });
    expect(res.headers.get("cache-control") ?? "").not.toContain("max-age");
  });

  it("answers 502 when both services time out or cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(502);
  });

  it("answers 502 when both services return something that is not a place list", async () => {
    providers(
      () => new Response("<html>Bad gateway</html>", { status: 200 }),
      () => json([1, 2, 3]),
    );
    const res = await POST(request("Colombo"));
    expect(res.status).toBe(502);
  });

  it("does not echo the query or any provider detail in the error", async () => {
    providers(
      () => json({ message: "secret upstream detail" }, 503),
      () => json({ message: "secret upstream detail" }, 500),
    );
    const res = await POST(request("Wathupitiwala"));
    const text = await res.text();
    expect(text).not.toContain("Wathupitiwala");
    expect(text).not.toContain("secret upstream detail");
  });
});
