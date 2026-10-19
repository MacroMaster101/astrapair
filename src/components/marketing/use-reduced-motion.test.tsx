import { renderToString } from "react-dom/server";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CelestialScene } from "./celestial-scene";
import { MotionLink } from "./motion-link";
import { ReadingExplorer } from "./reading-explorer";
import { Reveal } from "./reveal";
import { useReducedMotion } from "./use-reduced-motion";

// motion's own hook, which reads the setting once and answers differently on
// the server than in the browser. Components must not build markup from it.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motionReduced,
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

let reduced = true;
let motionReduced = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  reduced = true;
  listeners.clear();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        get matches() {
          return query.includes("reduce") && reduced;
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) =>
          listeners.delete(fn),
      }) as unknown as MediaQueryList,
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function Probe() {
  return <p>{useReducedMotion() ? "reduced" : "full"}</p>;
}

describe("useReducedMotion", () => {
  it("is false on the server whatever the setting", () => {
    expect(renderToString(<Probe />)).toContain("full");
  });

  it("matches the setting once the page is hydrated, and follows changes", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Probe />);
    document.body.append(container);

    await act(async () => {
      hydrateRoot(container, <Probe />);
    });
    expect(container.textContent).toBe("reduced");

    reduced = false;
    await act(async () => {
      for (const fn of listeners) fn();
    });
    expect(container.textContent).toBe("full");
  });
});

describe("the landing page motion components under reduced motion", () => {
  it("hydrate without a mismatch", async () => {
    const page = (
      <>
        <Reveal className="a">
          <p>One</p>
        </Reveal>
        <Reveal as="li" className="b">
          <p>Two</p>
        </Reveal>
        <CelestialScene />
        <MotionLink href="/signup">Start</MotionLink>
        <ReadingExplorer />
      </>
    );
    // The server cannot know the setting, and motion's own hook answers
    // differently there than in the browser.
    reduced = false;
    motionReduced = false;
    const html = renderToString(page);

    reduced = true;
    motionReduced = true;
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();

    await act(async () => {
      hydrateRoot(container, page, { onRecoverableError: recoverable });
    });

    expect(recoverable).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
