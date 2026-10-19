import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadMessage, ThreadSummary } from "@/lib/assistant/service";

const mocks = vi.hoisted(() => ({
  askQuestionAction: vi.fn(),
  startThreadAction: vi.fn(async () => {}),
  requireOnboardedUserId: vi.fn(async () => "user-1"),
  listThreads: vi.fn(),
  getThread: vi.fn(),
  getRemainingQuestions: vi.fn(),
  getPartnerOverview: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/app/(app)/ask/actions", () => ({
  askQuestionAction: mocks.askQuestionAction,
  startThreadAction: mocks.startThreadAction,
}));
vi.mock("@/lib/auth/session", () => ({
  requireOnboardedUserId: mocks.requireOnboardedUserId,
}));
vi.mock("@/lib/assistant/service", () => ({
  listThreads: mocks.listThreads,
  getThread: mocks.getThread,
  getRemainingQuestions: mocks.getRemainingQuestions,
}));
vi.mock("@/lib/partner/service", () => ({
  getPartnerOverview: mocks.getPartnerOverview,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  unstable_rethrow: () => {},
}));
// The service modules are server-only; only their types are used here.
vi.mock("server-only", () => ({}));

import AskPage from "@/app/(app)/ask/page";
import ThreadPage from "@/app/(app)/ask/[threadId]/page";
import { Conversation } from "./conversation";
import { QuestionForm } from "./question-form";
import { ThreadList } from "./thread-list";

const THREAD_ID = "0d5b1d3e-6f4a-4a35-9a53-2f6a3f0c8d11";

function thread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: THREAD_ID,
    type: "chart",
    title: "What does my Moon mean?",
    updatedAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

function message(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "m1",
    role: "user",
    content: "Hello",
    createdAt: "2026-09-20T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.listThreads.mockResolvedValue([]);
  mocks.getRemainingQuestions.mockResolvedValue(30);
  mocks.getPartnerOverview.mockResolvedValue({
    kind: "none",
    pendingInvite: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadList", () => {
  it("shows the empty state", () => {
    render(<ThreadList threads={[]} />);
    expect(screen.getByText("No questions yet.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("links each thread with its title, type and date", () => {
    render(
      <ThreadList
        threads={[
          thread(),
          thread({
            id: "other-id",
            type: "relationship",
            title: "About us",
            updatedAt: "2026-10-06T10:00:00Z",
          }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const first = within(items[0]).getByRole("link");
    expect(first.getAttribute("href")).toBe(`/ask/${THREAD_ID}`);
    expect(first.textContent).toContain("What does my Moon mean?");
    expect(within(items[0]).getByText("Your chart")).toBeTruthy();
    expect(within(items[0]).getByText("Sep 20, 2026")).toBeTruthy();

    expect(within(items[1]).getByRole("link").getAttribute("href")).toBe(
      "/ask/other-id",
    );
    expect(within(items[1]).getByText("Your relationship")).toBeTruthy();
  });
});

describe("Conversation", () => {
  it("renders messages in order, the user's apart from the assistant's", () => {
    render(
      <Conversation
        messages={[
          message({ id: "1", role: "user", content: "First question" }),
          message({ id: "2", role: "assistant", content: "First answer" }),
          message({ id: "3", role: "user", content: "Second question" }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("First question"),
      expect.stringContaining("First answer"),
      expect.stringContaining("Second question"),
    ]);
    expect(items[0].className).toContain("justify-end");
    expect(items[1].className).not.toContain("justify-end");
  });

  it("announces new answers politely", () => {
    render(<Conversation messages={[message()]} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(within(log).getByRole("list")).toBeTruthy();
  });

  it("keeps the same live region when the first answer arrives", () => {
    const { rerender } = render(<Conversation messages={[]} />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.getAttribute("aria-live")).toBe("polite");

    rerender(
      <Conversation
        messages={[message({ role: "assistant", content: "First answer" })]}
      />,
    );
    expect(screen.getByRole("log", { name: "Conversation" })).toBe(log);
    expect(within(log).getByText("First answer")).toBeTruthy();
  });

  it("splits an answer into paragraphs", () => {
    render(
      <Conversation
        messages={[
          message({
            role: "assistant",
            content: "First paragraph.\n\nSecond paragraph.\n\n\nThird.",
          }),
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    const paragraphs = item.querySelectorAll("p");
    expect(Array.from(paragraphs).map((p) => p.textContent)).toEqual([
      "First paragraph.",
      "Second paragraph.",
      "Third.",
    ]);
  });

  it("renders markup in questions and answers as plain text", () => {
    const script = "<script>alert(1)</script>";
    const image = '<img src="x" onerror="alert(2)">';
    const { container } = render(
      <Conversation
        messages={[
          message({ id: "1", role: "user", content: script }),
          message({ id: "2", role: "assistant", content: image }),
        ]}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(script)).toBeTruthy();
    expect(screen.getByText(image)).toBeTruthy();
  });

  it("invites a first question when there are no messages", () => {
    render(<Conversation messages={[]} />);
    expect(screen.getByText("Ask your first question below.")).toBeTruthy();
  });
});

describe("QuestionForm", () => {
  const field = () => screen.getByLabelText("Your question");
  const submit = () => screen.getByRole("button", { name: /ask|thinking/i });

  it("limits the question to 500 characters and counts them", () => {
    render(<QuestionForm threadId={THREAD_ID} />);
    expect(field().getAttribute("maxlength")).toBe("500");
    expect(screen.getByText("0/500")).toBeTruthy();
    fireEvent.change(field(), { target: { value: "Hello there" } });
    expect(screen.getByText("11/500")).toBeTruthy();
  });

  it("sends the thread id and the question", async () => {
    mocks.askQuestionAction.mockResolvedValue({ message: "sent" });
    render(<QuestionForm threadId={THREAD_ID} />);
    fireEvent.change(field(), { target: { value: "Will it work?" } });
    fireEvent.click(submit());
    await waitFor(() => expect(mocks.askQuestionAction).toHaveBeenCalled());
    const formData = mocks.askQuestionAction.mock.calls[0][1] as FormData;
    expect(formData.get("threadId")).toBe(THREAD_ID);
    expect(formData.get("question")).toBe("Will it work?");
  });

  it("disables the button and marks it busy while waiting", async () => {
    let resolve: (value: { message: string }) => void = () => {};
    mocks.askQuestionAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<QuestionForm threadId={THREAD_ID} />);
    fireEvent.change(field(), { target: { value: "Slow one" } });
    fireEvent.click(submit());

    const button = await screen.findByRole("button", { name: "Thinking..." });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      "Thinking. This can take up to a minute.",
    );

    resolve({ message: "sent" });
    const idle = await screen.findByRole("button", { name: "Ask" });
    expect(idle.hasAttribute("disabled")).toBe(false);
  });

  it("clears the question and refocuses the field after an answer", async () => {
    mocks.askQuestionAction.mockResolvedValue({ message: "sent" });
    render(<QuestionForm threadId={THREAD_ID} />);
    fireEvent.change(field(), { target: { value: "Gone soon" } });
    fireEvent.click(submit());

    await waitFor(() =>
      expect((field() as HTMLTextAreaElement).value).toBe(""),
    );
    expect(screen.getByText("0/500")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("keeps the question and shows the error when asking fails", async () => {
    mocks.askQuestionAction.mockResolvedValue({
      error: "The AI assistant is offline right now. Try again later.",
      values: { question: "Keep me" },
    });
    render(<QuestionForm threadId={THREAD_ID} />);
    fireEvent.change(field(), { target: { value: "Keep me" } });
    fireEvent.click(submit());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "The AI assistant is offline right now. Try again later.",
    );
    expect((field() as HTMLTextAreaElement).value).toBe("Keep me");
    expect(screen.getByText("7/500")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("shows a field error and marks the field invalid", async () => {
    mocks.askQuestionAction.mockResolvedValue({
      fieldErrors: { question: ["Ask a question of up to 500 characters."] },
      values: { question: "   " },
    });
    render(<QuestionForm threadId={THREAD_ID} />);
    fireEvent.change(field(), { target: { value: "   " } });
    fireEvent.click(submit());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Ask a question of up to 500 characters.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Ask page", () => {
  const render_ = async (error?: string | string[]) =>
    render(
      await AskPage({ searchParams: Promise.resolve({ error }) } as never),
    );

  it("requires an onboarded user and shows the heading, count and disclaimer", async () => {
    mocks.getRemainingQuestions.mockResolvedValue(12);
    await render_();
    expect(mocks.requireOnboardedUserId).toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Ask AstraPair" }),
    ).toBeTruthy();
    expect(screen.getByText("You have 12 questions left today.")).toBeTruthy();
    expect(
      screen.getByText(
        "For reflection and entertainment. Astrology isn't a substitute for professional advice.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("No questions yet.")).toBeTruthy();
  });

  it("uses the singular for one question left", async () => {
    mocks.getRemainingQuestions.mockResolvedValue(1);
    await render_();
    expect(screen.getByText("You have 1 question left today.")).toBeTruthy();
  });

  it("says when no questions are left", async () => {
    mocks.getRemainingQuestions.mockResolvedValue(0);
    await render_();
    expect(
      screen.getByText("You have no questions left today. Come back tomorrow."),
    ).toBeTruthy();
  });

  it("hides the relationship starter when not connected", async () => {
    await render_();
    expect(
      screen.getByRole("button", { name: "Ask about my chart" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask about us" })).toBeNull();
  });

  it("shows both starters when connected", async () => {
    mocks.getPartnerOverview.mockResolvedValue({
      kind: "connected",
      partnerDisplayName: "Alex",
    });
    await render_();
    expect(
      screen.getByRole("button", { name: "Ask about my chart" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask about us" })).toBeTruthy();
  });

  it("carries the thread type in each starter form", async () => {
    mocks.getPartnerOverview.mockResolvedValue({
      kind: "connected",
      partnerDisplayName: null,
    });
    const { container } = await render_();
    const types = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="type"]'),
    ).map((i) => i.value);
    expect(types).toEqual(["chart", "relationship"]);
  });

  it("still shows the chart starter when the partner status fails to load", async () => {
    mocks.getPartnerOverview.mockRejectedValue(new Error("down"));
    await render_();
    expect(
      screen.getByRole("button", { name: "Ask about my chart" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask about us" })).toBeNull();
  });

  it("lists existing threads", async () => {
    mocks.listThreads.mockResolvedValue([thread()]);
    await render_();
    expect(screen.queryByText("No questions yet.")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /What does my Moon mean\?/ })
        .getAttribute("href"),
    ).toBe(`/ask/${THREAD_ID}`);
  });

  it.each([
    ["not_connected", "You're not connected with a partner."],
    ["no_chart", "Add your birth details first."],
    ["error", "Something went wrong. Please try again."],
  ])("maps ?error=%s to friendly copy", async (code, copy) => {
    await render_(code);
    expect(screen.getByRole("alert").textContent).toBe(copy);
  });

  it.each(["<b>nope</b>", "constructor", "__proto__", ""])(
    "shows nothing for the unknown error %j",
    async (code) => {
      await render_(code);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("ignores a repeated error parameter", async () => {
    await render_(["error", "no_chart"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Conversation page", () => {
  const params = (threadId = THREAD_ID) =>
    ({ params: Promise.resolve({ threadId }) }) as never;

  it("renders the thread, the form, the count, the disclaimer and a back link", async () => {
    mocks.getThread.mockResolvedValue({
      thread: thread(),
      messages: [
        message({ id: "1", role: "user", content: "A question" }),
        message({ id: "2", role: "assistant", content: "An answer" }),
      ],
    });
    mocks.getRemainingQuestions.mockResolvedValue(5);
    render(await ThreadPage(params()));

    expect(mocks.requireOnboardedUserId).toHaveBeenCalled();
    expect(mocks.getThread).toHaveBeenCalledWith(THREAD_ID);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "What does my Moon mean?",
      }),
    ).toBeTruthy();
    expect(screen.getByText("A question")).toBeTruthy();
    expect(screen.getByText("An answer")).toBeTruthy();
    expect(screen.getByLabelText("Your question")).toBeTruthy();
    expect(screen.getByText("You have 5 questions left today.")).toBeTruthy();
    expect(screen.getByText(/For reflection and entertainment/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /All questions/ }).getAttribute("href"),
    ).toBe("/ask");
  });

  it("is not found when the thread is missing", async () => {
    mocks.getThread.mockResolvedValue(null);
    await expect(ThreadPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
