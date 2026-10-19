import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CheckEmailPage from "./page";

afterEach(cleanup);

describe("CheckEmailPage", () => {
  it("uses generic copy and takes no address from the URL", () => {
    // The page takes no props: an address in the URL would land in request logs.
    expect(CheckEmailPage.length).toBe(0);
    render(<CheckEmailPage />);
    expect(
      screen.getByText(
        "We sent a confirmation link to your email address. Open it to finish setting up your account.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "try a different email" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});
