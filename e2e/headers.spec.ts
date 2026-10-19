import {
  PROD,
  PUBLIC_PAGES,
  UNKNOWN_TOKEN,
  clickUntil,
  expect,
  openMobileMenu,
  test,
  visit,
  waitForHydration,
  watchPage,
} from "./helpers";

// Production-only strictness (no 'unsafe-eval', HSTS) is checked only when the
// suite runs against `next build && next start`, with E2E_PROD=1.

function directive(csp: string, name: string): string[] | undefined {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found?.split(/\s+/).slice(1);
}

function nonceOf(csp: string): string {
  const match = /'nonce-([^']+)'/.exec(csp);
  expect(match, "a nonce in script-src").not.toBeNull();
  return match![1];
}

/** Headers next.config.ts sets on every response. */
function expectStaticHeaders(headers: Record<string, string>) {
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["permissions-policy"]).toContain("geolocation=()");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
}

/** What the proxy sets on every page it handles. */
function expectCsp(csp: string | undefined) {
  expect(csp, "content-security-policy header").toBeTruthy();
  const policy = csp!;
  expect(directive(policy, "default-src")).toEqual(["'self'"]);
  expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
  expect(directive(policy, "object-src")).toEqual(["'none'"]);
  expect(directive(policy, "base-uri")).toEqual(["'self'"]);
  const script = directive(policy, "script-src") ?? [];
  expect(script).toContain("'strict-dynamic'");
  expect(script.some((source) => source.startsWith("'nonce-"))).toBe(true);
  expect(script).not.toContain("'unsafe-inline'");
  expect(directive(policy, "form-action")).toContain("'self'");
  // Guard against a wrong E2E_PROD: a dev server allows 'unsafe-eval', a
  // production build does not, and the flag decides which checks run.
  if (PROD) expect(script).not.toContain("'unsafe-eval'");
  else {
    expect(
      script,
      "this CSP has no 'unsafe-eval', so the target looks like a production build: set E2E_PROD=1",
    ).toContain("'unsafe-eval'");
  }
}

test.describe("response headers", () => {
  for (const path of ["/", "/login", "/signup", "/legal/privacy"]) {
    test(`${path} carries the CSP and the static security headers`, async ({
      request,
    }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const headers = response.headers();
      expectCsp(headers["content-security-policy"]);
      expectStaticHeaders(headers);
    });
  }

  test("the nonce changes on every request", async ({ request }) => {
    const [a, b, c] = await Promise.all(
      [1, 2, 3].map(() => request.get("/login")),
    );
    const nonces = [a, b, c].map((r) =>
      nonceOf(r.headers()["content-security-policy"]),
    );
    expect(new Set(nonces).size).toBe(3);
  });

  test("the nonce in the CSP is the one on the scripts in the HTML", async ({
    request,
  }) => {
    for (const path of ["/", "/login"]) {
      const response = await request.get(path);
      const nonce = nonceOf(response.headers()["content-security-policy"]);
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      const withNonce = scripts.filter((tag) =>
        tag.includes(`nonce="${nonce}"`),
      );
      expect(
        withNonce.length,
        `${path}: scripts carrying the request nonce`,
      ).toBeGreaterThan(0);
      // A script with a different nonce would never run.
      const others = scripts.filter(
        (tag) =>
          /\bnonce="[^"]+"/.test(tag) && !tag.includes(`nonce="${nonce}"`),
      );
      expect(others).toEqual([]);
    }
  });

  test("a path that looks like a file still gets the CSP", async ({
    request,
  }) => {
    const response = await request.get("/invite/aaa.png");
    const headers = response.headers();
    expectCsp(headers["content-security-policy"]);
    expectStaticHeaders(headers);
  });

  test("a 404 page and a redirect carry the CSP", async ({ request }) => {
    const notFound = await request.get("/this-page-does-not-exist");
    expect(notFound.status()).toBe(404);
    expectCsp(notFound.headers()["content-security-policy"]);

    const redirect = await request.get("/dashboard", { maxRedirects: 0 });
    expect(redirect.status()).toBeGreaterThanOrEqual(300);
    expect(redirect.status()).toBeLessThan(400);
    expectCsp(redirect.headers()["content-security-policy"]);
    expectStaticHeaders(redirect.headers());
  });

  test("API routes behind the proxy carry the CSP", async ({ request }) => {
    const response = await request.post("/api/places", { data: { q: "x" } });
    expect(response.status()).toBe(401);
    expectCsp(response.headers()["content-security-policy"]);
    expectStaticHeaders(response.headers());
  });

  test("the health check and real assets carry only the static headers", async ({
    request,
  }) => {
    for (const path of [
      "/api/health",
      "/brand/astrapair-mark.webp",
      "/images/celestial-pair.png",
      "/animations/connection-orbit-light-still.png",
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expectStaticHeaders(response.headers());
      expect(
        response.headers()["content-security-policy"],
        `${path} should skip the proxy`,
      ).toBeUndefined();
    }
  });

  test("HSTS is sent by a production build", async ({ request }) => {
    test.skip(!PROD, "HSTS is only sent by production builds (E2E_PROD=1).");
    const response = await request.get("/");
    expect(response.headers()["strict-transport-security"]).toContain(
      "max-age=63072000",
    );
  });

  test("the production CSP has no unsafe-eval", async ({ request }) => {
    test.skip(!PROD, "Dev mode needs unsafe-eval (E2E_PROD=1 to check).");
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"];
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("localhost");
  });
});

test.describe("CSP in the browser", () => {
  // The suite default is reduced motion. These tests are about the CSP and
  // the console, so they run with the usual setting; the reduced motion case
  // for the landing page has its own test below.
  test.use({ reducedMotion: "no-preference" });

  test("the page's nonce matches the header and a script uses it", async ({
    page,
  }) => {
    const response = await page.goto("/login");
    const nonce = nonceOf(
      (await response!.allHeaders())["content-security-policy"],
    );
    // Browsers hide the attribute value but expose it on the element.
    const nonces = await page.evaluate(() =>
      Array.from(document.querySelectorAll("script"))
        .map((script) => script.nonce)
        .filter(Boolean),
    );
    expect(nonces.length).toBeGreaterThan(0);
    expect(new Set(nonces)).toEqual(new Set([nonce]));
  });

  for (const entry of PUBLIC_PAGES) {
    test(`${entry.name} loads with no console errors or CSP violations`, async ({
      page,
    }) => {
      const watch = await watchPage(page);
      const response = await page.goto(entry.path);
      // A 404 page makes the browser log the failed document load itself.
      const expectedStatus = entry.name === "not found" ? 404 : 200;
      expect(response?.status()).toBe(expectedStatus);
      await expect(
        page.getByRole("heading", { name: entry.heading }).first(),
      ).toBeVisible();
      // Let hydration and the first effects run before reading the logs.
      await waitForHydration(page);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      expect(await watch.violations(), "CSP violations").toEqual([]);
      // The browser logs one "Failed to load resource" error for the 404
      // document itself. A second one would be a missing script or stylesheet.
      const isLoadFailure = (e: string) =>
        e.includes("Failed to load resource");
      if (expectedStatus === 404) {
        expect(
          watch.errors().filter(isLoadFailure).length,
          "failed resource loads on the 404 page",
        ).toBeLessThanOrEqual(1);
      }
      expect(
        expectedStatus === 404
          ? watch.errors().filter((e) => !isLoadFailure(e))
          : watch.errors(),
        "console errors",
      ).toEqual([]);
    });
  }

  test("the landing page keeps working after opening menus and tabs", async ({
    page,
  }) => {
    const watch = await watchPage(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await visit(page, "/");
    await openMobileMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("navigation", { name: "Mobile" })).toBeHidden();
    const attraction = page.getByRole("tab", { name: "Attraction" });
    await clickUntil(
      page,
      attraction,
      async () => (await attraction.getAttribute("aria-selected")) === "true",
      "the Attraction tab is selected",
    );
    const html = page.locator("html");
    const wasDark = await html.evaluate((el) => el.classList.contains("dark"));
    await clickUntil(
      page,
      page.getByRole("button", { name: "Toggle dark mode" }),
      async () =>
        (await html.evaluate((el) => el.classList.contains("dark"))) !==
        wasDark,
      "the theme class changed",
    );
    expect(await watch.violations(), "CSP violations").toEqual([]);
    expect(watch.errors(), "console errors").toEqual([]);
  });

  test("an invite token page keeps the token out of the Referer", async ({
    page,
  }) => {
    await visit(page, `/invite/${UNKNOWN_TOKEN}`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
  });
});

// Under prefers-reduced-motion the landing page must render the same markup on
// the server and on the first client render, or React logs a hydration
// mismatch (a development-only warning). The preference is set for the whole
// context, so it is on from the very first request.
test.describe("landing page under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the landing page hydrates cleanly with reduced motion on", async ({
    page,
  }) => {
    const watch = await watchPage(page);
    await visit(page, "/");
    // The mismatch is reported when the whole page has been hydrated, which is
    // later than the first attached handler: wait for the last link.
    await waitForHydration(page, page.locator("footer a").last());
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(watch.errors(), "console errors").toEqual([]);
  });

  test("scroll reveals are static and fully visible with reduced motion on", async ({
    page,
  }) => {
    await visit(page, "/");
    await waitForHydration(page, page.locator("footer a").last());
    // No scrolling: a section far below the fold must already be shown, with
    // no fade or slide left to run.
    const reveal = page.locator(".section-heading").first();
    await expect(reveal).toHaveCSS("opacity", "1");
    await expect(reveal).toHaveCSS("transform", "none");
    const hero = page.locator(".hero-copy").first();
    await expect(hero).toHaveCSS("opacity", "1");
    await expect(hero).toHaveCSS("transform", "none");
  });
});

test.describe("landing page with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("scroll reveals still fade in when they scroll into view", async ({
    page,
  }) => {
    await visit(page, "/");
    await waitForHydration(page, page.locator("footer a").last());
    const reveal = page.locator(".section-heading").first();
    await expect(reveal).toHaveCSS("opacity", "0");
    await reveal.scrollIntoViewIfNeeded();
    await expect(reveal).toHaveCSS("opacity", "1");
    await expect(reveal).toHaveCSS("transform", "none");
  });
});

// The describe above turns reduced motion off for the landing page's sake.
// These pages do not use the scroll-reveal components, so they are watched
// under the suite's default, reduced motion on.
test.describe("console under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const path of [
    "/login",
    "/signup",
    "/forgot-password",
    "/legal/terms",
  ]) {
    test(`${path} logs no errors or CSP violations`, async ({ page }) => {
      const watch = await watchPage(page);
      await visit(page, path);
      expect(await watch.violations(), "CSP violations").toEqual([]);
      expect(watch.errors(), "console errors").toEqual([]);
    });
  }
});
