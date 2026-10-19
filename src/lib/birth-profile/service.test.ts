import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuiltInProvider } from "@/lib/astrology/engine";
import { getAstrologyProvider } from "@/lib/astrology/provider";
import type { BirthInput } from "@/lib/astrology/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireUserId: vi.fn(async () => "user-1"),
}));
vi.mock("@/lib/astrology/provider", async () => {
  const { BuiltInProvider: Provider } = await import("@/lib/astrology/engine");
  const provider = new Provider();
  return { getAstrologyProvider: () => provider };
});

type Result = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};
type Table = "charts" | "birth_profiles";
interface Call {
  client: "user" | "admin";
  table: Table;
  op: "select" | "insert" | "delete";
  payload?: unknown;
  filters: Array<[string, unknown[]]>;
}

const fake = vi.hoisted(() => ({
  calls: [] as Call[],
  results: {} as Record<string, Result>,
  adminThrows: false,
}));

function makeClient(client: Call["client"]) {
  const builder = (table: Table, op: Call["op"], payload?: unknown) => {
    const call: Call = { client, table, op, payload, filters: [] };
    fake.calls.push(call);
    const result = () => fake.results[`${table}.${op}`];
    const b: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "select"]) {
      b[m] = (...args: unknown[]) => {
        call.filters.push([m, args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result());
    b.then = (
      resolve: (v: Result) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return {
    from: (table: Table) => ({
      select: () => builder(table, "select"),
      insert: (row: unknown) => builder(table, "insert", row),
      delete: () => builder(table, "delete"),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient("user"),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (fake.adminThrows) throw new Error("SUPABASE_SECRET_KEY is not set");
    return makeClient("admin");
  },
}));

const { getCurrentChart, getChartForVerifiedPartner } =
  await import("./service");

const input: BirthInput = {
  birthDate: "1990-07-15",
  birthTime: "12:00",
  accuracy: "exact",
  latitude: 6.93548,
  longitude: 79.84868,
  timezone: "Asia/Colombo",
};
const profile = {
  id: "profile-1",
  displayName: null,
  placeLabel: "Colombo, Sri Lanka",
  input,
};
const provider = getAstrologyProvider() as BuiltInProvider;
const validChart = new BuiltInProvider().calculateNatalChart(input);
const ops = (op: Call["op"], client?: Call["client"]) =>
  fake.calls.filter(
    (c) =>
      c.table === "charts" && c.op === op && (!client || c.client === client),
  );

let calculate: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fake.calls = [];
  fake.adminThrows = false;
  fake.results = {
    "charts.select": { data: null, error: null },
    "charts.insert": { error: null },
    "charts.delete": { error: null },
    "birth_profiles.select": { data: null, error: null },
  };
  calculate = vi.spyOn(provider, "calculateNatalChart");
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectNoBirthDataLogged(profileId: string, stage: string) {
  expect(consoleError).toHaveBeenCalled();
  for (const args of consoleError.mock.calls) {
    const logged = JSON.stringify(args);
    expect(logged).toContain(profileId);
    expect(logged).toContain(stage);
    for (const secret of [
      input.birthDate,
      input.birthTime!,
      String(input.latitude),
      String(input.longitude),
      input.timezone,
      profile.placeLabel,
      "bad row",
    ]) {
      expect(logged).not.toContain(secret);
    }
  }
}

describe("getCurrentChart", () => {
  beforeEach(() => {
    // The user client can see the profile, so the caller owns it.
    fake.results["birth_profiles.select"] = {
      data: { id: "profile-1" },
      error: null,
    };
  });

  it("reuses a valid stored chart without calculating, and prunes old ones", async () => {
    fake.results["charts.select"] = {
      data: { chart_json: JSON.parse(JSON.stringify(validChart)) },
      error: null,
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: validChart });
    expect(calculate).not.toHaveBeenCalled();
    expect(ops("insert")).toHaveLength(0);
    // The user client reads; only the admin client prunes.
    expect(ops("select", "user")).toHaveLength(1);
    expect(ops("delete", "user")).toHaveLength(0);
    const prune = ops("delete", "admin");
    expect(prune).toHaveLength(1);
    expect(prune[0].filters.map(([m]) => m)).toEqual(["eq", "neq"]);
  });

  it("calculates, then stores and prunes with the admin client", async () => {
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: validChart });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(ops("insert")).toHaveLength(1);
    expect(ops("insert")[0].client).toBe("admin");
    expect(ops("insert")[0].payload).toMatchObject({
      birth_profile_id: "profile-1",
      house_system: "placidus",
    });
    expect(ops("delete")).toHaveLength(1);
    expect(ops("delete")[0].client).toBe("admin");
  });

  it("returns the computed chart when a concurrent insert wins (23505)", async () => {
    fake.results["charts.insert"] = {
      error: { code: "23505", message: "duplicate" },
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: validChart });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("reports a failure without logging birth data when loading fails", async () => {
    fake.results["charts.select"] = {
      data: null,
      error: {
        code: "PGRST301",
        message: "bad row for 1990-07-15 12:00 at 6.93548",
      },
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: null, error: true });
    expectNoBirthDataLogged("profile-1", "load");
    for (const args of consoleError.mock.calls) {
      expect(JSON.stringify(args)).toContain("PGRST301");
    }
    const [, details] = consoleError.mock.calls[0];
    expect(details).toMatchObject({ profileId: "profile-1", stage: "load" });
  });

  it("recalculates when the stored chart is invalid", async () => {
    const broken = JSON.parse(JSON.stringify(validChart));
    broken.placements = broken.placements.slice(1);
    fake.results["charts.select"] = {
      data: { chart_json: broken },
      error: null,
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: validChart });
    expect(calculate).toHaveBeenCalledTimes(1);
    // The bad row is dropped, the fresh chart stored, then old charts pruned,
    // all through the admin client.
    expect(ops("delete")).toHaveLength(2);
    expect(ops("delete").every((c) => c.client === "admin")).toBe(true);
    expect(ops("delete")[0].filters.map(([m]) => m)).toEqual(["eq", "eq"]);
    expect(ops("insert")).toHaveLength(1);
    expect(ops("insert")[0].client).toBe("admin");
  });

  it("checks ownership with the user client and never writes for a profile it cannot see", async () => {
    fake.results["birth_profiles.select"] = { data: null, error: null };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: null, error: true });
    const check = fake.calls.find((c) => c.table === "birth_profiles");
    expect(check?.client).toBe("user");
    expect(check?.filters).toContainEqual(["eq", ["id", "profile-1"]]);
    expect(calculate).not.toHaveBeenCalled();
    expect(ops("insert")).toHaveLength(0);
    expect(ops("delete")).toHaveLength(0);
    expect(fake.calls.some((c) => c.client === "admin")).toBe(false);
    expectNoBirthDataLogged("profile-1", "not_found");
  });

  it("reports a failure when the ownership check errors, without writing", async () => {
    fake.results["birth_profiles.select"] = {
      data: null,
      error: { code: "PGRST301", message: "bad row for 1990-07-15" },
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: null, error: true });
    expect(ops("insert")).toHaveLength(0);
    expectNoBirthDataLogged("profile-1", "PGRST301");
  });

  it("still returns a stored chart when the secret key is missing during prune", async () => {
    fake.adminThrows = true;
    fake.results["charts.select"] = {
      data: { chart_json: JSON.parse(JSON.stringify(validChart)) },
      error: null,
    };
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: validChart });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message, details] = consoleError.mock.calls[0];
    expect(message).toBe("Chart prune failed");
    expect(details).toEqual({
      profileId: "profile-1",
      stage: "prune",
      code: "config",
    });
  });

  it("reports a store failure when the secret key is missing on insert", async () => {
    fake.adminThrows = true;
    const result = await getCurrentChart(profile);
    expect(result).toEqual({ chart: null, error: true });
    expect(consoleError.mock.calls[0][1]).toEqual({
      profileId: "profile-1",
      stage: "store",
      code: "config",
    });
  });
});

describe("getChartForVerifiedPartner", () => {
  const partnerRow = {
    id: "profile-2",
    owner_user_id: "partner-1",
    display_name: "Sam",
    birth_date: input.birthDate,
    birth_time: "12:00:00",
    birth_time_accuracy: input.accuracy,
    birth_place_label: profile.placeLabel,
    latitude: input.latitude,
    longitude: input.longitude,
    timezone_id: input.timezone,
  };

  it("reports missing when the partner has no birth profile", async () => {
    const result = await getChartForVerifiedPartner("partner-1");
    expect(result).toEqual({ chart: null, missing: true });
    expect(ops("select")).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("returns the stored chart with the partner's display name", async () => {
    fake.results["birth_profiles.select"] = { data: partnerRow, error: null };
    fake.results["charts.select"] = {
      data: { chart_json: JSON.parse(JSON.stringify(validChart)) },
      error: null,
    };
    const result = await getChartForVerifiedPartner("partner-1");
    expect(result).toEqual({ chart: validChart, displayName: "Sam" });
    expect(calculate).not.toHaveBeenCalled();
    const lookup = fake.calls.find((c) => c.table === "birth_profiles");
    expect(lookup?.client).toBe("admin");
    expect(lookup?.filters).toContainEqual([
      "eq",
      ["owner_user_id", "partner-1"],
    ]);
    // Nothing goes through the user client for a partner.
    expect(fake.calls.every((c) => c.client === "admin")).toBe(true);
  });

  it("reports an error when the admin client cannot be created", async () => {
    fake.adminThrows = true;
    const result = await getChartForVerifiedPartner("partner-1");
    expect(result).toEqual({ chart: null, error: true });
    expect(fake.calls).toHaveLength(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][1]).toEqual({
      stage: "load",
      code: "config",
    });
  });

  it("reports an error without logging birth data when the profile load fails", async () => {
    fake.results["birth_profiles.select"] = {
      data: null,
      error: {
        code: "PGRST301",
        message: "bad row for 1990-07-15 12:00 at 6.93548",
      },
    };
    const result = await getChartForVerifiedPartner("partner-1");
    expect(result).toEqual({ chart: null, error: true });
    expect(consoleError).toHaveBeenCalled();
    for (const args of consoleError.mock.calls) {
      const logged = JSON.stringify(args);
      expect(logged).toContain("PGRST301");
      for (const secret of [
        input.birthDate,
        input.birthTime!,
        String(input.latitude),
        String(input.longitude),
        input.timezone,
        profile.placeLabel,
        "bad row",
      ]) {
        expect(logged).not.toContain(secret);
      }
    }
  });

  it("reports an error without logging birth data when the chart load fails", async () => {
    fake.results["birth_profiles.select"] = { data: partnerRow, error: null };
    fake.results["charts.select"] = {
      data: null,
      error: {
        code: "PGRST301",
        message: "bad row for 1990-07-15 12:00 at 6.93548",
      },
    };
    const result = await getChartForVerifiedPartner("partner-1");
    expect(result).toEqual({ chart: null, error: true });
    expectNoBirthDataLogged("profile-2", "load");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("Sam");
  });
});
