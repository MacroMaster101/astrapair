import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const reporter = vi.hoisted(() => ({ reportBoundaryError: vi.fn() }));
vi.mock("@/lib/monitoring/client", () => reporter);

import AppError from "./error";

describe("AppError", () => {
  afterEach(() => {
    cleanup();
    reporter.reportBoundaryError.mockClear();
  });

  it("shows a friendly message without the error details", () => {
    render(
      <AppError
        error={new Error("connection refused at db.internal:5432")}
        reset={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeTruthy();
    expect(screen.queryByText(/db\.internal/)).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Go to your dashboard" })
        .getAttribute("href"),
    ).toBe("/dashboard");
  });

  it("tries again when asked", () => {
    const reset = vi.fn();
    render(<AppError error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reports only the name and digest, never the message", () => {
    const error = Object.assign(new Error("failed for sam@example.com"), {
      digest: "abc123",
    });
    render(<AppError error={error} reset={() => {}} />);
    expect(reporter.reportBoundaryError).toHaveBeenCalledTimes(1);
    expect(reporter.reportBoundaryError).toHaveBeenCalledWith({
      name: "Error",
      digest: "abc123",
    });
    expect(
      JSON.stringify(reporter.reportBoundaryError.mock.calls),
    ).not.toContain("sam@example.com");
  });
});
