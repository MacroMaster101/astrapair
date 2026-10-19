import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "./theme-provider";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function themeScript(container: HTMLElement) {
  return container.querySelector("script");
}

describe("ThemeProvider script", () => {
  it("is a normal inline script by default", () => {
    const { container } = render(<ThemeProvider>child</ThemeProvider>);
    expect(themeScript(container)?.getAttribute("type")).toBeNull();
  });

  it("becomes an inert data block when it cannot get a nonce", () => {
    const { container } = render(
      <ThemeProvider inertScript>child</ThemeProvider>,
    );
    expect(themeScript(container)?.getAttribute("type")).toBe(
      "application/json",
    );
  });
});
