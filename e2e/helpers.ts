import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type ConsoleMessage,
  type Locator,
  type Page,
} from "@playwright/test";

/** The target is a production build: no dev-only allowances. */
export const PROD = process.env.E2E_PROD === "1";

/**
 * Console errors that only a dev server prints and that come from a library,
 * not from the app: React 19 warns about the inline script that next-themes
 * renders. They are ignored unless E2E_PROD=1, where they cannot appear.
 */
const DEV_ONLY_NOISE = ["Encountered a script tag while rendering React"];

/**
 * Two errors that appear when the dev server's hot reload reaches a page
 * before React has mounted it. They are matched narrowly and ignored only
 * when E2E_PROD is not "1".
 *
 * 1. "Router action dispatched before initialization." is also thrown by
 *    client code that production builds contain (a click or prefetch before
 *    the router exists), so the message alone is NOT ignored. It is ignored
 *    only when the message matches and the error's stack also passes through
 *    `hmrRefresh`. That function
 *    (next/dist/client/components/app-router-instance.js) starts with
 *    `if (process.env.NODE_ENV !== 'development') throw ...`, so a stack
 *    through it cannot complete in a production build, and the caller seen in
 *    the stack is the dev socket handler
 *    (next/dist/client/dev/hot-reloader/app/hot-reloader-app.js).
 * 2. "Can't perform a React state update on a component that hasn't mounted
 *    yet" is raised by `warnAboutUpdateOnNotYetMountedFiberInDEV`; the string
 *    is absent from react-dom-client.production.js, so a production build
 *    cannot print it. Both are the same cause: a hot-reload refresh arriving
 *    before hydration (seen on about 1 in 20 plain loads of /login on `next dev`).
 */
const DEV_HMR_STACK = "hmrRefresh";
const DEV_ROUTER_MESSAGE = "Router action dispatched before initialization";
const DEV_ONLY_REACT_WARNING = "hasn't mounted yet";

export type Scheme = "light" | "dark";
export const SCHEMES: Scheme[] = ["light", "dark"];
export const WIDTHS = [375, 768, 1280] as const;

/** A well-formed invite token (43 URL-safe characters) that matches no invite. */
export const UNKNOWN_TOKEN = randomBytes(32).toString("base64url");

export interface PublicPage {
  name: string;
  path: string;
  /** Visible text of the main heading: proves the page rendered. */
  heading: RegExp;
}

export const PUBLIC_PAGES: PublicPage[] = [
  { name: "landing", path: "/", heading: /the universe/i },
  { name: "login", path: "/login", heading: /welcome back/i },
  { name: "signup", path: "/signup", heading: /create your account/i },
  {
    name: "forgot password",
    path: "/forgot-password",
    heading: /forgot your password/i,
  },
  { name: "privacy", path: "/legal/privacy", heading: /privacy/i },
  { name: "terms", path: "/legal/terms", heading: /terms/i },
  { name: "disclaimer", path: "/legal/disclaimer", heading: /disclaimer/i },
  {
    name: "invite, well-formed unknown token",
    path: `/invite/${UNKNOWN_TOKEN}`,
    heading: /this invite isn't valid/i,
  },
  {
    name: "invite, malformed token",
    path: "/invite/abc",
    heading: /this invite isn't valid/i,
  },
  {
    name: "not found",
    path: "/this-page-does-not-exist",
    heading: /404|could not be found/i,
  },
];

/**
 * `test` with one guard: any request to an origin other than the app's own is
 * aborted and fails the test, so the suite never depends on a third party.
 */
export const test = base.extend<{ noThirdParties: void }>({
  noThirdParties: [
    async ({ context, baseURL }, use) => {
      const own = new URL(baseURL ?? "http://localhost:3000").origin;
      const blocked: string[] = [];
      await context.route(/^https?:/, (route) => {
        const url = new URL(route.request().url());
        if (url.origin === own) return route.fallback();
        blocked.push(url.origin);
        return route.abort();
      });
      await use();
      expect(
        [...new Set(blocked)],
        "requests to other origins from the browser",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export interface PageWatch {
  /** console.error messages and uncaught page errors. */
  errors: () => string[];
  /** Content Security Policy violations reported by the browser. */
  violations: () => Promise<string[]>;
}

/**
 * Start recording console errors, uncaught errors and CSP violations. Call it
 * before navigating: the violation listener is installed ahead of page scripts.
 */
export async function watchPage(page: Page): Promise<PageWatch> {
  const errors: string[] = [];
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!PROD && DEV_ONLY_NOISE.some((noise) => text.includes(noise))) return;
    if (!PROD && text.includes(DEV_ONLY_REACT_WARNING)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => {
    // Both the message and the stack must match: any other error that happens
    // to pass through hmrRefresh is still reported.
    if (
      !PROD &&
      error.message.includes(DEV_ROUTER_MESSAGE) &&
      error.stack?.includes(DEV_HMR_STACK)
    ) {
      return;
    }
    errors.push(error.message);
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__cspViolations.push(
        `${event.violatedDirective} blocked ${event.blockedURI || "inline"}`,
      );
    });
  });
  return {
    errors: () => errors,
    violations: () =>
      page.evaluate(
        () =>
          (window as unknown as { __cspViolations?: string[] })
            .__cspViolations ?? [],
      ),
  };
}

/**
 * Wait until React has attached to the page. Clicks and media-query changes
 * made before that are silently lost, and a dev server can take seconds to get
 * there. React tags every DOM node it manages with a "__reactProps$" key.
 *
 * Pass the control the test is about to use to wait for that element itself,
 * which is what proves its handlers are attached. Without it the wait only
 * proves that hydration has started somewhere on the page.
 */
export async function waitForHydration(page: Page, control?: Locator) {
  if (control) {
    await expect
      .poll(
        () =>
          control.evaluate((element) =>
            Object.keys(element).some((key) => key.startsWith("__reactProps$")),
          ),
        { message: "the control is hydrated" },
      )
      .toBe(true);
    return;
  }
  await page.waitForFunction(() =>
    Array.from(document.body.querySelectorAll("*")).some((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactProps$")),
    ),
  );
}

/**
 * Click a control until its effect is visible. A click that lands before the
 * control's handler is attached does nothing, so the test retries the click
 * (and only the click) until `done` is true, then fails with a clear message.
 * `done` must be safe to evaluate repeatedly, and a click is not repeated once
 * it has had its effect, so toggles are not flipped back.
 */
export async function clickUntil(
  page: Page,
  control: Locator,
  done: () => Promise<boolean>,
  message: string,
) {
  await waitForHydration(page, control);
  await expect(async () => {
    if (await done()) return;
    await control.click({ timeout: 2_000 });
    await expect.poll(done, { timeout: 2_000, message }).toBe(true);
  }, message).toPass({ timeout: 20_000 });
}

/** Open the landing page's mobile menu and wait until it is expanded. */
export async function openMobileMenu(page: Page) {
  const button = page.getByRole("button", { name: /^(open|close) menu$/i });
  await clickUntil(
    page,
    button,
    async () => (await button.getAttribute("aria-expanded")) === "true",
    "the mobile menu button reports aria-expanded=true",
  );
  await expect(page.getByRole("navigation", { name: "Mobile" })).toBeVisible();
}

/** Open a page and wait until it is interactive. */
export async function visit(page: Page, path: string) {
  await page.goto(path);
  await waitForHydration(page);
}

/** Switch the colour scheme and wait until next-themes has applied it. */
export async function setScheme(page: Page, scheme: Scheme) {
  await waitForHydration(page);
  await page.emulateMedia({ colorScheme: scheme });
  const html = page.locator("html");
  if (scheme === "dark") await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
}

export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    scrollWidth,
    "document scrollWidth vs viewport width",
  ).toBeLessThanOrEqual(innerWidth);
}

/**
 * Let the scroll-reveal fades finish. Contrast is measured on the blended
 * colour, so a section that is half faded in reads as too light. Sections
 * reveal when they scroll into view, so walk down the page, then back up.
 */
async function settleReveals(page: Page) {
  await page.evaluate(async () => {
    const step = Math.max(window.innerHeight * 0.6, 200);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  const unsettled = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[style*="opacity"]'))
        .filter(
          (element) =>
            element.closest("[hidden]") === null &&
            getComputedStyle(element).opacity !== "1",
        )
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}${element.className ? "." + String(element.className).trim().split(/\s+/).join(".") : ""}`,
        ),
    );
  await expect
    .poll(unsettled, {
      timeout: 10_000,
      message:
        "elements with an inline opacity below 1 never settled (a permanent opacity needs a different check)",
    })
    .toEqual([]);
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Run axe on the current page. Serious and critical violations fail the test;
 * moderate and minor ones are printed and attached as annotations.
 */
export async function expectNoSeriousA11yViolations(page: Page, label: string) {
  await settleReveals(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();

  const describe = (v: (typeof violations)[number]) =>
    `${v.id} (${v.impact}): ${v.help}\n` +
    v.nodes
      .slice(0, 5)
      .map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary}`)
      .join("\n");

  const minor = violations.filter(
    (v) => v.impact !== "serious" && v.impact !== "critical",
  );
  for (const v of minor) {
    console.log(`[axe ${v.impact}] ${label}: ${describe(v)}`);
    test.info().annotations.push({
      type: `axe-${v.impact}`,
      description: `${label}: ${v.id}`,
    });
  }

  const blocking = violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    blocking.map(describe),
    `serious or critical axe violations on ${label}`,
  ).toEqual([]);
}
