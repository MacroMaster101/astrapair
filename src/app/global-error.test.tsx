import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reporter = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock("@/lib/monitoring/client", () => reporter);
vi.mock("@/components/theme/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}));

import GlobalError from "./global-error";

function renderPage(error: Error & { digest?: string }, reset = () => {}) {
  return render(<GlobalError error={error} reset={reset} />, {
    container: document,
  });
}

describe("GlobalError", () => {
  afterEach(() => {
    cleanup();
    reporter.reportBoundaryError.mockClear();
  });

  it("shows friendly copy without the error details", () => {
    renderPage(new Error("connection refused at db.internal:5432"));
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeTruthy();
    expect(screen.queryByText(/db\.internal/)).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Go to the home page" })
        .getAttribute("href"),
    ).toBe("/");
  });

  it("owns the html element with a language", () => {
    renderPage(new Error("boom"));
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("tries again when asked", () => {
    const reset = vi.fn();
    renderPage(new Error("boom"), reset);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reports the error once, passing the error object to the safe reporter", () => {
    const error = Object.assign(new Error("secret message sam@example.com"), {
      digest: "abc123",
    });
    renderPage(error);
    expect(reporter.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(reporter.reportBoundaryError).toHaveBeenCalledWith({
      name: "Error",
      digest: "abc123",
    });
    expect(
      JSON.stringify(reporter.reportBoundaryError.mock.calls),
    ).not.toContain("secret message");
  });
});
