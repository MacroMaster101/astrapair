import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

const fake = vi.hoisted(() => ({
  order: [] as string[],
  saveResult: { chartError: false } as { chartError: boolean },
  saveThrows: null as Error | null,
  profile: { id: "bp-1", input: { birthDate: "1990-07-15" } } as unknown,
  chartResult: { chart: {} } as { chart: unknown },
  saveBirthProfile: vi.fn(),
  getOwnBirthProfile: vi.fn(),
  getCurrentChart: vi.fn(),
  trackAfterResponse: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    fake.order.push("redirect");
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: async () => "user-1",
}));
vi.mock("@/lib/birth-profile/service", () => {
  class BirthProfileSaveError extends Error {}
  return {
    BirthProfileSaveError,
    saveBirthProfile: fake.saveBirthProfile,
    getOwnBirthProfile: fake.getOwnBirthProfile,
    getCurrentChart: fake.getCurrentChart,
  };
});
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: (...args: unknown[]) => {
    fake.order.push(`track:${String(args[0])}`);
    fake.trackAfterResponse(...args);
  },
}));

import { BirthProfileSaveError } from "@/lib/birth-profile/service";
import { recalculateChart, saveBirthDetails } from "./actions";

function form(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    displayName: "Ari",
    birthDate: "1990-07-15",
    accuracy: "exact",
    birthTime: "12:00",
    placeLabel: "Colombo, Western Province, Sri Lanka",
    latitude: "6.93548",
    longitude: "79.84868",
    timezone: "Asia/Colombo",
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  fake.order = [];
  fake.saveResult = { chartError: false };
  fake.saveThrows = null;
  fake.profile = { id: "bp-1", input: { birthDate: "1990-07-15" } };
  fake.chartResult = { chart: {} };
  fake.saveBirthProfile.mockReset();
  fake.saveBirthProfile.mockImplementation(async () => {
    if (fake.saveThrows) throw fake.saveThrows;
    return fake.saveResult;
  });
  fake.getOwnBirthProfile.mockReset();
  fake.getOwnBirthProfile.mockImplementation(async () => fake.profile);
  fake.getCurrentChart.mockReset();
  fake.getCurrentChart.mockImplementation(async () => fake.chartResult);
  fake.trackAfterResponse.mockClear();
  fake.revalidatePath.mockClear();
});

describe("saveBirthDetails analytics", () => {
  it("tracks the profile and the chart, before redirecting", async () => {
    await expect(saveBirthDetails({}, form())).rejects.toMatchObject({
      url: "/chart",
    });
    expect(fake.trackAfterResponse.mock.calls).toEqual([
      ["birth_profile_completed", "user-1"],
      ["chart_generated", "user-1"],
    ]);
    expect(fake.order).toEqual([
      "track:birth_profile_completed",
      "track:chart_generated",
      "redirect",
    ]);
  });

  it("tracks the profile but not the chart when the chart failed", async () => {
    fake.saveResult = { chartError: true };
    await expect(saveBirthDetails({}, form())).rejects.toMatchObject({
      url: "/chart",
    });
    expect(fake.trackAfterResponse.mock.calls).toEqual([
      ["birth_profile_completed", "user-1"],
    ]);
  });

  it("tracks nothing when the save fails", async () => {
    fake.saveThrows = new BirthProfileSaveError();
    const state = await saveBirthDetails({}, form());
    expect(state.error).toBe(
      "We couldn't save your birth details. Please try again.",
    );
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("tracks nothing when the form is invalid", async () => {
    const state = await saveBirthDetails({}, form({ birthDate: "nope" }));
    expect(state.fieldErrors?.birthDate).toBeDefined();
    expect(fake.saveBirthProfile).not.toHaveBeenCalled();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("never sends birth data to analytics", async () => {
    await expect(saveBirthDetails({}, form())).rejects.toBeInstanceOf(
      RedirectError,
    );
    const sent = JSON.stringify(fake.trackAfterResponse.mock.calls);
    for (const secret of ["1990-07-15", "12:00", "Asia/Colombo", "Colombo"]) {
      expect(sent).not.toContain(secret);
    }
  });
});

describe("recalculateChart analytics", () => {
  it("tracks chart_generated when the retry produces a chart, before redirecting", async () => {
    await expect(recalculateChart()).rejects.toMatchObject({ url: "/chart" });
    expect(fake.getCurrentChart).toHaveBeenCalledWith(fake.profile);
    expect(fake.trackAfterResponse.mock.calls).toEqual([
      ["chart_generated", "user-1"],
    ]);
    expect(fake.order).toEqual(["track:chart_generated", "redirect"]);
  });

  it("does not track when the chart still fails", async () => {
    fake.chartResult = { chart: null };
    await expect(recalculateChart()).rejects.toMatchObject({ url: "/chart" });
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track when there is no birth profile", async () => {
    fake.profile = null;
    await expect(recalculateChart()).rejects.toMatchObject({ url: "/chart" });
    expect(fake.getCurrentChart).not.toHaveBeenCalled();
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("still redirects when the calculation throws, logging a fixed message with a code only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.getCurrentChart.mockRejectedValue(new Error("boom 1990-07-15"));
    await expect(recalculateChart()).rejects.toMatchObject({ url: "/chart" });
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Chart retry failed", {
      stage: "retry",
      code: "exception",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("1990");
    error.mockRestore();
  });
});
