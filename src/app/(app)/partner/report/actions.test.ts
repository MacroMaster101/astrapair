import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

const fake = vi.hoisted(() => ({
  result: { ok: true } as { ok: boolean; code?: string; generated?: true },
  generateReport: vi.fn(),
  revalidatePath: vi.fn(),
  requireOnboardedUserId: vi.fn(),
  trackAfterResponse: vi.fn(),
  order: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    fake.order.push("redirect");
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: fake.requireOnboardedUserId,
}));
vi.mock("@/lib/analytics/track", () => ({
  trackAfterResponse: (...args: unknown[]) => {
    fake.order.push("track");
    fake.trackAfterResponse(...args);
  },
}));
vi.mock("@/lib/report/service", () => ({
  generateReport: fake.generateReport,
}));

import { generateReportAction } from "./actions";

beforeEach(() => {
  fake.result = { ok: true };
  fake.generateReport.mockReset();
  fake.generateReport.mockImplementation(async () => fake.result);
  fake.revalidatePath.mockClear();
  fake.requireOnboardedUserId.mockReset();
  fake.requireOnboardedUserId.mockResolvedValue("user-1");
  fake.trackAfterResponse.mockClear();
  fake.order = [];
});

describe("generateReportAction", () => {
  it("requires an onboarded user before generating", async () => {
    fake.requireOnboardedUserId.mockRejectedValue(new RedirectError("/login"));
    await expect(
      generateReportAction({}, new FormData()),
    ).rejects.toMatchObject({ url: "/login" });
    expect(fake.generateReport).not.toHaveBeenCalled();
  });

  it("revalidates and redirects to the report on success", async () => {
    await expect(
      generateReportAction({}, new FormData()),
    ).rejects.toMatchObject({ url: "/partner/report" });
    expect(fake.generateReport).toHaveBeenCalledTimes(1);
    expect(fake.revalidatePath).toHaveBeenCalledWith("/partner");
    expect(fake.revalidatePath).toHaveBeenCalledWith("/partner/report");
  });

  it("tracks report_generated before redirecting when a new report was made", async () => {
    fake.result = { ok: true, generated: true };
    await expect(
      generateReportAction({}, new FormData()),
    ).rejects.toMatchObject({ url: "/partner/report" });
    expect(fake.trackAfterResponse).toHaveBeenCalledTimes(1);
    expect(fake.trackAfterResponse).toHaveBeenCalledWith(
      "report_generated",
      "user-1",
    );
    expect(fake.order).toEqual(["track", "redirect"]);
  });

  it("does not track a cache hit", async () => {
    fake.result = { ok: true };
    await expect(
      generateReportAction({}, new FormData()),
    ).rejects.toMatchObject({ url: "/partner/report" });
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it("does not track a failure", async () => {
    fake.result = { ok: false, code: "invalid_output" };
    await generateReportAction({}, new FormData());
    expect(fake.trackAfterResponse).not.toHaveBeenCalled();
  });

  it.each([
    [
      "in_progress",
      "Your report is already being created. Check back in a minute.",
    ],
    [
      "limit",
      "You've created the maximum number of reports for today. Try again tomorrow.",
    ],
    [
      "ai_unavailable",
      "The AI assistant is offline right now. Try again later.",
    ],
    [
      "invalid_output",
      "We couldn't create a reliable report this time. Please try again.",
    ],
    ["waiting_for_charts", "Both of you need to add birth details first."],
    ["not_connected", "You're not connected with a partner."],
    ["error", "Something went wrong. Please try again."],
  ])("maps %s to friendly copy without redirecting", async (code, message) => {
    fake.result = { ok: false, code };
    const state = await generateReportAction({}, new FormData());
    expect(state).toEqual({ error: message });
    expect(fake.revalidatePath).not.toHaveBeenCalled();
  });
});
