import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuiltInProvider, ENGINE_VERSION } from "@/lib/astrology/engine";
import { calculateSynastry, orientForViewer } from "@/lib/astrology/synastry";
import type { BirthInput, NatalChart } from "@/lib/astrology/types";
import * as session from "@/lib/auth/session";
import * as birthService from "@/lib/birth-profile/service";

vi.mock("server-only", () => ({}));

type Result = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};
interface Upsert {
  table: string;
  row: Record<string, unknown>;
  options: unknown;
}

const fake = vi.hoisted(() => ({
  userId: "user-1",
  rpc: {} as Record<string, Result>,
  synastrySelect: { data: null, error: null } as Result,
  upsertResult: { error: null } as Result,
  adminThrows: false,
  upserts: [] as Upsert[],
  ownProfile: null as unknown,
  ownChart: null as unknown,
  partnerResult: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (name: string) => Promise.resolve(fake.rpc[name]),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(table === "synastry" ? fake.synastrySelect : null),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (fake.adminThrows) throw new Error("SUPABASE_SECRET_KEY is not set");
    return {
      from: (table: string) => ({
        upsert: (row: Record<string, unknown>, options: unknown) => {
          fake.upserts.push({ table, row, options });
          return Promise.resolve(fake.upsertResult);
        },
      }),
    };
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn(async () => fake.userId),
  getProfile: vi.fn(async () => ({
    id: fake.userId,
    display_name: "Me",
    onboarded_at: "2026-01-01T00:00:00Z",
  })),
}));
vi.mock("@/lib/birth-profile/service", () => ({
  getOwnBirthProfile: vi.fn(async () => fake.ownProfile),
  getCurrentChart: vi.fn(async () => fake.ownChart),
  getChartForVerifiedPartner: vi.fn(async () => fake.partnerResult),
}));

const {
  getPartnerOverview,
  getPartnerState,
  loadRelationshipContext,
  summarizeChart,
  synastryKey,
} = await import("./service");

const provider = new BuiltInProvider();
const colombo: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const london: BirthInput = {
  birthDate: "1988-02-03",
  birthTime: "08:45",
  accuracy: "exact",
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: "Europe/London",
};
const own = provider.calculateNatalChart(colombo);
const partner = provider.calculateNatalChart(london);
const partnerUnknown = provider.calculateNatalChart({
  ...london,
  birthTime: null,
  accuracy: "unknown",
});

const relationshipRow = {
  relationship_id: "rel-1",
  partner_user_id: "user-2",
  partner_display_name: "Sam",
  connected_at: "2026-09-01T00:00:00Z",
};

function connect(partnerChart: NatalChart | null = partner) {
  fake.rpc.get_my_relationship = { data: [relationshipRow], error: null };
  fake.ownProfile = {
    id: "p-1",
    displayName: "Me",
    placeLabel: "Colombo",
    input: colombo,
  };
  fake.ownChart = { chart: own };
  fake.partnerResult = partnerChart
    ? { chart: partnerChart, displayName: "Sam" }
    : { chart: null, missing: true };
}

const connectedState = async () => {
  const state = await getPartnerState();
  if (state.kind !== "connected") throw new Error("expected connected");
  return state;
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fake.userId = "user-1";
  fake.rpc = {
    get_my_relationship: { data: [], error: null },
    get_my_pending_invite: { data: [], error: null },
  };
  fake.synastrySelect = { data: null, error: null };
  fake.upsertResult = { error: null };
  fake.adminThrows = false;
  fake.upserts = [];
  fake.ownProfile = null;
  fake.ownChart = null;
  fake.partnerResult = null;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPartnerState without a partner", () => {
  it("returns none with no invite and no birth profile", async () => {
    expect(await getPartnerState()).toEqual({
      kind: "none",
      hasBirthProfile: false,
      pendingInvite: null,
    });
  });

  it("returns the pending invite expiry and birth profile flag", async () => {
    fake.rpc.get_my_pending_invite = {
      data: [{ created_at: "2026-09-01T00:00:00Z", expires_at: "2026-09-08" }],
      error: null,
    };
    fake.ownProfile = {
      id: "p-1",
      displayName: null,
      placeLabel: "",
      input: colombo,
    };
    expect(await getPartnerState()).toEqual({
      kind: "none",
      hasBirthProfile: true,
      pendingInvite: { expiresAt: "2026-09-08" },
    });
  });

  it("throws when the relationship lookup fails", async () => {
    fake.rpc.get_my_relationship = { data: null, error: { code: "XX000" } };
    await expect(getPartnerState()).rejects.toThrow();
  });
});

describe("getPartnerOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the partner name from the relationship without loading charts", async () => {
    fake.rpc.get_my_relationship = { data: [relationshipRow], error: null };
    const overview = await getPartnerOverview();
    expect(overview).toEqual({
      kind: "connected",
      partnerDisplayName: "Sam",
    });
    expect(fake.upserts).toHaveLength(0);
    expect(birthService.getOwnBirthProfile).not.toHaveBeenCalled();
    expect(birthService.getCurrentChart).not.toHaveBeenCalled();
    expect(birthService.getChartForVerifiedPartner).not.toHaveBeenCalled();
  });

  it("keeps a missing partner name as null", async () => {
    fake.rpc.get_my_relationship = {
      data: [{ ...relationshipRow, partner_display_name: null }],
      error: null,
    };
    expect(await getPartnerOverview()).toEqual({
      kind: "connected",
      partnerDisplayName: null,
    });
  });

  it("returns none with no pending invite", async () => {
    expect(await getPartnerOverview()).toEqual({
      kind: "none",
      pendingInvite: null,
    });
  });

  it("returns the pending invite expiry", async () => {
    fake.rpc.get_my_pending_invite = {
      data: [{ expires_at: "2026-10-01T00:00:00Z" }],
      error: null,
    };
    expect(await getPartnerOverview()).toEqual({
      kind: "none",
      pendingInvite: { expiresAt: "2026-10-01T00:00:00Z" },
    });
  });

  it("throws when either lookup fails", async () => {
    fake.rpc.get_my_relationship = {
      data: null,
      error: { code: "XX000", message: "boom" },
    };
    await expect(getPartnerOverview()).rejects.toThrow(
      "Failed to load relationship",
    );
    fake.rpc.get_my_relationship = { data: [], error: null };
    fake.rpc.get_my_pending_invite = {
      data: null,
      error: { code: "XX000", message: "boom" },
    };
    await expect(getPartnerOverview()).rejects.toThrow("Failed to load invite");
  });
});

describe("getPartnerState when connected", () => {
  it("calculates and stores synastry when nothing is stored", async () => {
    connect();
    const state = await connectedState();
    expect(state.relationshipId).toBe("rel-1");
    expect(state.connectedAt).toBe("2026-09-01T00:00:00Z");
    expect(state.synastryError).toBe(false);
    expect(state.synastry).toEqual(calculateSynastry(own, partner));
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].table).toBe("synastry");
    expect(fake.upserts[0].options).toEqual({ onConflict: "relationship_id" });
    expect(fake.upserts[0].row).toMatchObject({
      relationship_id: "rel-1",
      input_hash: synastryKey(own, partner),
      calculation_version: ENGINE_VERSION,
    });
  });

  it("uses stored synastry when the key matches", async () => {
    connect();
    const facts = calculateSynastry(own, partner);
    fake.synastrySelect = {
      data: { input_hash: synastryKey(own, partner), facts_json: facts },
      error: null,
    };
    const state = await connectedState();
    expect(state.synastry).toEqual(facts);
    expect(fake.upserts).toHaveLength(0);
  });

  it("recalculates when the stored key differs", async () => {
    connect();
    fake.synastrySelect = {
      data: {
        input_hash: "old-key",
        facts_json: { ...calculateSynastry(own, own), aspects: [] },
      },
      error: null,
    };
    const state = await connectedState();
    expect(state.synastry).toEqual(calculateSynastry(own, partner));
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].row.input_hash).toBe(synastryKey(own, partner));
  });

  it("recalculates when stored facts are malformed or from another engine", async () => {
    connect();
    const key = synastryKey(own, partner);
    for (const facts_json of [
      {
        schemaVersion: 1,
        engineVersion: "0.0.0",
        aspects: [],
        overlays: {},
        excluded: {},
      },
      {
        schemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        aspects: "x",
        overlays: {},
        excluded: {},
      },
      {
        schemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        aspects: [],
        overlays: null,
        excluded: {},
      },
      "nonsense",
    ]) {
      fake.upserts = [];
      fake.synastrySelect = {
        data: { input_hash: key, facts_json },
        error: null,
      };
      const state = await connectedState();
      expect(state.synastry).toEqual(calculateSynastry(own, partner));
      expect(fake.upserts).toHaveLength(1);
    }
  });

  it("reports the partner as having no chart without an error", async () => {
    connect(null);
    const state = await connectedState();
    expect(state.partner).toEqual({
      displayName: "Sam",
      hasChart: false,
      bigThree: null,
      signs: null,
    });
    expect(state.you.hasChart).toBe(true);
    expect(state.synastry).toBeNull();
    expect(state.synastryError).toBe(false);
    expect(fake.upserts).toHaveLength(0);
  });

  it("orients synastry so the viewer is side a when they sort second", async () => {
    connect();
    fake.userId = "user-9";
    const state = await connectedState();
    // Partner ("user-2") sorts first, so the stored order is partner then viewer.
    expect(state.synastry).toEqual(
      orientForViewer(calculateSynastry(partner, own), false),
    );
    expect(fake.upserts[0].row.input_hash).toBe(synastryKey(partner, own));
  });

  it("keeps birth data out of both summaries", async () => {
    for (const partnerChart of [partner, partnerUnknown]) {
      connect(partnerChart);
      const state = await connectedState();
      for (const summary of [state.partner, state.you]) {
        const json = JSON.stringify(summary);
        for (const input of [colombo, london]) {
          for (const secret of [
            input.birthDate,
            input.birthTime,
            input.timezone,
            String(input.latitude),
          ]) {
            if (secret) expect(json).not.toContain(secret);
          }
        }
      }
    }
  });

  it("returns synastryError when the upsert fails, logging no birth data", async () => {
    connect();
    fake.upsertResult = {
      error: { code: "P0001", message: "relationship_not_active 1988-02-03" },
    };
    const state = await connectedState();
    expect(state.synastry).toBeNull();
    expect(state.synastryError).toBe(true);
    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("rel-1");
    for (const secret of [
      "1988-02-03",
      "08:45",
      "Europe/London",
      "51.5074",
      "1990-07-15",
      "Asia/Colombo",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("returns synastryError when the admin client is not configured", async () => {
    connect();
    fake.adminThrows = true;
    const state = await connectedState();
    expect(state.synastry).toBeNull();
    expect(state.synastryError).toBe(true);
  });

  it("returns synastryError when a chart could not be loaded", async () => {
    connect();
    fake.partnerResult = { chart: null, error: true };
    const state = await connectedState();
    expect(state.partner.hasChart).toBe(false);
    expect(state.synastry).toBeNull();
    expect(state.synastryError).toBe(true);
  });
});

describe("loadRelationshipContext", () => {
  it("returns null when not connected", async () => {
    expect(await loadRelationshipContext()).toBeNull();
  });

  it("keeps canonical order when the viewer sorts first", async () => {
    connect();
    const context = await loadRelationshipContext();
    expect(context).toMatchObject({
      relationshipId: "rel-1",
      connectedAt: "2026-09-01T00:00:00Z",
      viewerUserId: "user-1",
      partnerUserId: "user-2",
      viewerIsA: true,
      names: { viewer: "Me", partner: "Sam" },
      viewerChart: own,
      synastry: calculateSynastry(own, partner),
      synastryKey: synastryKey(own, partner),
      chartsMissing: false,
      error: false,
    });
    expect(context?.viewer).toEqual(summarizeChart(own, "Me"));
    expect(context?.partner).toEqual(summarizeChart(partner, "Sam"));
  });

  it("keeps canonical order when the viewer sorts second", async () => {
    connect();
    fake.userId = "user-9";
    const context = await loadRelationshipContext();
    expect(context).toMatchObject({
      viewerUserId: "user-9",
      partnerUserId: "user-2",
      viewerIsA: false,
      viewerChart: own,
      // Not oriented: side a is still the partner ("user-2" sorts first).
      synastry: calculateSynastry(partner, own),
      synastryKey: synastryKey(partner, own),
      error: false,
    });
  });

  it("falls back to generic names when display names are missing", async () => {
    connect();
    fake.rpc.get_my_relationship = {
      data: [{ ...relationshipRow, partner_display_name: null }],
      error: null,
    };
    vi.mocked(session.getProfile).mockResolvedValueOnce({
      id: "user-1",
      display_name: null,
      onboarded_at: "2026-01-01T00:00:00Z",
    });
    const context = await loadRelationshipContext();
    expect(context?.names).toEqual({ viewer: "You", partner: "Your partner" });
    expect(context?.viewer.displayName).toBeNull();
    expect(context?.partner.displayName).toBeNull();
  });

  it("flags missing charts without an error", async () => {
    connect(null);
    const context = await loadRelationshipContext();
    expect(context).toMatchObject({
      chartsMissing: true,
      error: false,
      synastry: null,
      synastryKey: null,
    });
    connect();
    fake.ownProfile = null;
    const noOwn = await loadRelationshipContext();
    expect(noOwn).toMatchObject({
      chartsMissing: true,
      error: false,
      viewerChart: null,
      synastry: null,
    });
  });

  it("flags an error when a chart fails to load or synastry fails", async () => {
    connect();
    fake.partnerResult = { chart: null, error: true };
    expect(await loadRelationshipContext()).toMatchObject({
      error: true,
      synastry: null,
      synastryKey: null,
    });
    connect();
    fake.upsertResult = { error: { code: "P0001" } };
    expect(await loadRelationshipContext()).toMatchObject({
      error: true,
      chartsMissing: false,
      synastry: null,
      synastryKey: null,
    });
  });
});

describe("summarizeChart", () => {
  it("returns an empty summary without a chart", () => {
    expect(summarizeChart(null, "Sam")).toEqual({
      displayName: "Sam",
      hasChart: false,
      bigThree: null,
      signs: null,
    });
  });

  it("uses the Moon range for an unknown birth time", () => {
    const summary = summarizeChart(partnerUnknown, null);
    expect(summary.bigThree?.ascendant).toBe("Needs a birth time");
    const moon = summary.signs?.find((s) => s.body === "moon");
    expect(moon?.sign).toBe(summary.bigThree?.moon);
  });
});
