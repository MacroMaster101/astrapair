import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`redirect:${url}`);
  }
}

type Result = { ok: true; threadId?: string } | { ok: false; code: string };

const fake = vi.hoisted(() => ({
  userId: "user-1",
  createResult: { ok: true, threadId: "t-1" } as Result,
  askResult: { ok: true } as Result,
  createThread: vi.fn(),
  askQuestion: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: fake.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: async () => fake.userId,
}));
vi.mock("@/lib/ai/config", () => ({
  getAiConfig: () => ({ dailyQuestionLimit: 30 }),
}));
vi.mock("@/lib/assistant/service", () => ({
  createThread: fake.createThread,
  askQuestion: fake.askQuestion,
}));

import { askQuestionAction, startThreadAction } from "./actions";

const THREAD_ID = "0b9b3a5e-5d3c-4c0e-9d4b-2f1f6f5a7c11";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

let n = 0;
beforeEach(() => {
  n += 1;
  fake.userId = `user-${n}`; // the rate limiter is module state; isolate per test
  fake.createResult = { ok: true, threadId: "t-1" };
  fake.askResult = { ok: true };
  fake.createThread.mockReset();
  fake.createThread.mockImplementation(async () => fake.createResult);
  fake.askQuestion.mockReset();
  fake.askQuestion.mockImplementation(async () => fake.askResult);
  fake.revalidatePath.mockClear();
});

describe("startThreadAction", () => {
  it.each(["chart", "relationship"])(
    "creates a %s thread and redirects to it",
    async (type) => {
      fake.createResult = { ok: true, threadId: "abc" };
      await expect(startThreadAction(form({ type }))).rejects.toMatchObject({
        url: "/ask/abc",
      });
      expect(fake.createThread).toHaveBeenCalledWith(type);
    },
  );

  it("rejects an unknown type without creating a thread", async () => {
    await expect(
      startThreadAction(form({ type: "other" })),
    ).rejects.toMatchObject({ url: "/ask?error=error" });
    expect(fake.createThread).not.toHaveBeenCalled();
  });

  it.each(["not_connected", "no_chart", "error"])(
    "redirects to /ask?error=%s on failure",
    async (code) => {
      fake.createResult = { ok: false, code };
      await expect(
        startThreadAction(form({ type: "chart" })),
      ).rejects.toMatchObject({ url: `/ask?error=${code}` });
    },
  );
});

describe("askQuestionAction", () => {
  const ask = (fields: Record<string, string>) =>
    askQuestionAction({}, form(fields));

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["too long", "x".repeat(501)],
  ])("rejects a %s question without calling the service", async (_n, q) => {
    const state = await ask({ threadId: THREAD_ID, question: q });
    expect(state.fieldErrors?.question).toEqual([
      "Ask a question of up to 500 characters.",
    ]);
    expect(fake.askQuestion).not.toHaveBeenCalled();
  });

  it("rejects a malformed thread id without calling the service", async () => {
    const state = await ask({ threadId: "nope", question: "Hi?" });
    expect(state.error).toBe("We couldn't find that conversation.");
    expect(fake.askQuestion).not.toHaveBeenCalled();
  });

  it("asks the trimmed question, revalidates the thread and returns sent", async () => {
    const state = await ask({
      threadId: THREAD_ID,
      question: "  What is my moon sign?  ",
    });
    expect(state).toEqual({ message: "sent" });
    expect(fake.askQuestion).toHaveBeenCalledWith(
      THREAD_ID,
      "What is my moon sign?",
    );
    expect(fake.revalidatePath).toHaveBeenCalledWith(`/ask/${THREAD_ID}`);
  });

  it("accepts a question of exactly 500 characters", async () => {
    const state = await ask({ threadId: THREAD_ID, question: "x".repeat(500) });
    expect(state).toEqual({ message: "sent" });
  });

  it.each([
    [
      "limit",
      "You've reached today's limit of 30 questions. Try again tomorrow.",
    ],
    [
      "ai_unavailable",
      "The AI assistant is offline right now. Try again later.",
    ],
    [
      "not_connected",
      "This conversation ended when you disconnected from your partner.",
    ],
    ["not_found", "We couldn't find that conversation."],
    ["no_chart", "Add your birth details first."],
    ["error", "Something went wrong. Please try again."],
  ])(
    "maps %s to friendly copy and keeps the question",
    async (code, message) => {
      fake.askResult = { ok: false, code };
      const state = await ask({ threadId: THREAD_ID, question: "Why?" });
      expect(state).toEqual({ error: message, values: { question: "Why?" } });
      expect(fake.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("limits to 10 questions per minute per user", async () => {
    for (let i = 0; i < 10; i++) {
      const ok = await ask({ threadId: THREAD_ID, question: "Why?" });
      expect(ok.error).toBeUndefined();
    }
    const limited = await ask({ threadId: THREAD_ID, question: "Why?" });
    expect(limited.error).toBe(
      "You're asking quickly. Wait a minute and try again.",
    );
    expect(fake.askQuestion).toHaveBeenCalledTimes(10);
  });

  it("never logs the question text", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    fake.askResult = { ok: false, code: "error" };
    await ask({ threadId: THREAD_ID, question: "secret-question-text" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-question");
      spy.mockRestore();
    }
  });
});
