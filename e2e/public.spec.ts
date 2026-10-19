import {
  PUBLIC_PAGES,
  UNKNOWN_TOKEN,
  WIDTHS,
  clickUntil,
  expect,
  expectNoHorizontalScroll,
  openMobileMenu,
  setScheme,
  test,
  visit,
} from "./helpers";

test.describe("landing page", () => {
  test("renders its heading, navigation and calls to action", async ({
    page,
  }) => {
    await visit(page, "/");
    await expect(
      page.getByRole("heading", { level: 1, name: /the universe/i }),
    ).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(
      nav.getByRole("link", { name: /get started/i }),
    ).toHaveAttribute("href", "/signup");
    await expect(
      page.getByRole("link", { name: "Explore your connection" }),
    ).toHaveAttribute("href", "/signup");
    await expect(
      page.getByRole("link", { name: "Create your account" }),
    ).toHaveAttribute("href", "/signup");
    await expect(
      page.getByRole("link", { name: "Read our privacy policy" }),
    ).toHaveAttribute("href", "/legal/privacy");

    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    await expect(
      footer.getByRole("link", { name: "Disclaimer" }),
    ).toHaveAttribute("href", "/legal/disclaimer");
  });

  test("has the sections that the navigation links to", async ({ page }) => {
    await visit(page, "/");
    for (const id of ["reading", "how-it-works", "privacy"]) {
      await expect(page.locator(`section#${id}`)).toBeAttached();
    }
  });

  test("reading tabs switch the visible panel", async ({ page }) => {
    await visit(page, "/");
    const communication = page.getByRole("tab", { name: "Communication" });
    const emotional = page.getByRole("tab", { name: "Emotional needs" });
    await expect(communication).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);

    await clickUntil(
      page,
      emotional,
      async () => (await emotional.getAttribute("aria-selected")) === "true",
      "the Emotional needs tab is selected",
    );
    await expect(emotional).toHaveAttribute("aria-selected", "true");
    await expect(communication).toHaveAttribute("aria-selected", "false");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await expect(page.getByRole("tabpanel")).toContainText(
      "Moon placements & aspects",
    );

    // Arrow keys move between tabs.
    await emotional.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Attraction" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("FAQ answers open and close", async ({ page }) => {
    await visit(page, "/");
    const question = "Do I need to know my exact birth time?";
    const item = page.locator("details").filter({ hasText: question });
    await expect(item).toHaveJSProperty("open", false);
    await item.getByText(question).click();
    await expect(item).toHaveJSProperty("open", true);
    await expect(
      item.getByText(/You can create a chart without it/),
    ).toBeVisible();
    await item.getByText(question).click();
    await expect(item).toHaveJSProperty("open", false);
  });

  test("the mobile menu opens, lists the sections and closes on Escape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await visit(page, "/");
    const open = page.getByRole("button", { name: "Open menu" });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await openMobileMenu(page);

    const menu = page.getByRole("navigation", { name: "Mobile" });
    await expect(
      menu.getByRole("link", { name: /how it works/i }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: /your reading/i }),
    ).toBeVisible();
    await expect(menu.getByRole("link", { name: /privacy/i })).toBeVisible();
    await expect(menu.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/login",
    );

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    const reopen = page.getByRole("button", { name: "Open menu" });
    await expect(reopen).toBeFocused();
    await expect(reopen).toHaveAttribute("aria-expanded", "false");
  });

  test("shows the deleted-account notice only for ?account=deleted", async ({
    page,
  }) => {
    await visit(page, "/");
    await expect(page.getByText("Your account has been deleted.")).toHaveCount(
      0,
    );
    await visit(page, "/?account=deleted");
    await expect(page.getByRole("status")).toHaveText(
      "Your account has been deleted.",
    );
    await visit(page, "/?account=something-else");
    await expect(page.getByText("Your account has been deleted.")).toHaveCount(
      0,
    );
  });
});

test.describe("sign in, sign up and password reset", () => {
  test("login has labelled fields, a submit button and a Google button", async ({
    page,
  }) => {
    await visit(page, "/login");
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });

  test("the password field can be revealed and hidden", async ({ page }) => {
    await visit(page, "/login");
    const password = page.getByLabel("Password", { exact: true });
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("signup has labelled fields", async ({ page }) => {
    await visit(page, "/signup");
    await expect(
      page.getByRole("heading", { level: 1, name: "Create your account" }),
    ).toBeVisible();
    await expect(page.getByLabel("Display name")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/legal/privacy");
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveAttribute("href", "/login");
  });

  test("forgot password has a labelled email field", async ({ page }) => {
    await visit(page, "/forgot-password");
    await expect(
      page.getByRole("heading", { level: 1, name: "Forgot your password?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("type", "email");
    await expect(
      page.getByRole("link", { name: "Sign in", exact: true }),
    ).toHaveAttribute("href", "/login");
  });

  test("the login form submits with Enter and shows validation errors", async ({
    page,
  }) => {
    await visit(page, "/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("whatever");
    await page.getByLabel("Password", { exact: true }).press("Enter");
    // Rejected by validation on the server before any sign-in is attempted.
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the forgot-password form submits with Enter and shows validation errors", async ({
    page,
  }) => {
    await visit(page, "/forgot-password");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Email").press("Enter");
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  test("the signup form submits with Enter and shows validation errors", async ({
    page,
  }) => {
    await visit(page, "/signup");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Email").press("Enter");
    // Validation runs before the rate limiter and before any account is created.
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  test("login shows fixed copy for known ?error= codes", async ({ page }) => {
    const cases: Array<[string, RegExp]> = [
      ["oauth_no_account", /no AstraPair account for that Google email/],
      ["oauth_failed", /couldn't sign you in/],
      ["oauth_unavailable", /Google sign-in isn't available right now/],
      ["oauth_rate_limited", /Too many attempts/],
    ];
    for (const [code, message] of cases) {
      await visit(page, `/login?error=${code}`);
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        message,
      );
    }
  });

  test("login shows nothing for an unknown ?error= value", async ({ page }) => {
    await visit(page, "/login?error=%3Cb%3Eboom%3C%2Fb%3E");
    await expect(
      page.getByRole("heading", { level: 1, name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("boom")).toHaveCount(0);
  });

  test("login passes a safe ?next= to the sign-up link and drops an unsafe one", async ({
    page,
  }) => {
    await visit(page, "/login?next=%2Fchart");
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup?next=%2Fchart");
    await visit(page, "/login?next=https%3A%2F%2Fevil.example");
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });
});

test.describe("legal documents", () => {
  for (const [slug, title] of [
    ["privacy", "Privacy"],
    ["terms", "Terms"],
    ["disclaimer", "Disclaimer"],
  ] as const) {
    test(`/legal/${slug} renders its sections and the draft notice`, async ({
      page,
    }) => {
      await visit(page, `/legal/${slug}`);
      await expect(
        page.getByRole("heading", { level: 1, name: new RegExp(title, "i") }),
      ).toBeVisible();
      await expect(
        page.getByText(/^Draft version .+, pending legal review\.$/),
      ).toBeVisible();
      expect(
        await page.getByRole("heading", { level: 2 }).count(),
      ).toBeGreaterThan(0);
      const others = page.getByRole("navigation", { name: "Legal documents" });
      await expect(others.getByRole("link")).toHaveCount(2);
      await expect(
        page.getByRole("link", { name: "Back to home" }),
      ).toBeVisible();
    });
  }

  test("an unknown legal document is a 404", async ({ page }) => {
    const response = await page.goto("/legal/nothing-here");
    expect(response?.status()).toBe(404);
  });
});

test.describe("protected routes", () => {
  for (const route of [
    "/dashboard",
    "/settings",
    "/partner",
    "/chart",
    "/ask",
  ]) {
    test(`${route} redirects a signed-out visitor to sign in`, async ({
      page,
    }) => {
      await visit(page, route);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(route)}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Welcome back" }),
      ).toBeVisible();
    });
  }

  test("a nested protected path keeps its full path and query in next", async ({
    page,
  }) => {
    await visit(page, "/chart/birth-details?x=1");
    await expect(page).toHaveURL(
      `/login?next=${encodeURIComponent("/chart/birth-details?x=1")}`,
    );
  });
});

test.describe("invite links", () => {
  test("a well-formed token that matches no invite shows the not-valid state", async ({
    page,
  }) => {
    expect(UNKNOWN_TOKEN).toHaveLength(43);
    await visit(page, `/invite/${UNKNOWN_TOKEN}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "This invite isn't valid" }),
    ).toBeVisible();
  });

  test("a malformed token shows the same not-valid state", async ({ page }) => {
    await visit(page, "/invite/abc");
    await expect(
      page.getByRole("heading", { level: 1, name: "This invite isn't valid" }),
    ).toBeVisible();
  });

  test("invite pages are kept out of search results", async ({ page }) => {
    await visit(page, "/invite/abc");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });
});

test.describe("API routes", () => {
  test("/api/health reports ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("release");
  });

  test("/api/places rejects a signed-out request", async ({ request }) => {
    const response = await request.post("/api/places", { data: { q: "x" } });
    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to search places.",
    });
  });

  test("/api/places does not accept a place in a URL", async ({ request }) => {
    const response = await request.get("/api/places?q=Colombo");
    expect(response.status()).toBe(405);
    expect(response.headers()["allow"]).toBe("POST");
  });
});

test.describe("not found", () => {
  test("an unknown route shows the 404 page", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  });
});

test.describe("theme", () => {
  test("the toggle switches the theme class and the choice survives a reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await visit(page, "/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);

    await page.getByRole("button", { name: "Toggle dark mode" }).click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

    await page.reload();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);

    await page.getByRole("button", { name: "Toggle dark mode" }).click();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    await page.reload();
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  });

  test("with no saved choice the page follows the operating system", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await visit(page, "/login");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    await setScheme(page, "light");
  });

  test("the toggle is available on the auth, legal and invite pages", async ({
    page,
  }) => {
    for (const path of ["/login", "/legal/terms", "/invite/abc"]) {
      await visit(page, path);
      await expect(
        page.getByRole("button", { name: "Toggle dark mode" }),
      ).toBeVisible();
    }
  });
});

test.describe("keyboard", () => {
  test("on the landing page the first Tab stop is the skip link, and it works", async ({
    page,
  }) => {
    await visit(page, "/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main-content$/);
  });

  // The first Tab stop per page: a changed focus order should fail here.
  const FIRST_TAB_STOP = [
    { path: "/login", name: "AstraPair home" },
    { path: "/signup", name: "AstraPair home" },
    { path: "/forgot-password", name: "AstraPair home" },
    { path: "/legal/terms", name: "Back to home" },
  ];
  for (const { path, name } of FIRST_TAB_STOP) {
    test(`on ${path} the first Tab lands on "${name}"`, async ({ page }) => {
      await visit(page, path);
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name }).first()).toBeFocused();
    });
  }

  test("Tab order on the login form follows the visual order", async ({
    page,
  }) => {
    await visit(page, "/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Show password" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Forgot password?" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  });
});

test.describe("no horizontal scroll", () => {
  for (const width of WIDTHS) {
    for (const entry of PUBLIC_PAGES) {
      test(`${entry.name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await visit(page, entry.path);
        await expect(
          page.getByRole("heading", { name: entry.heading }).first(),
        ).toBeVisible();
        await expectNoHorizontalScroll(page);
        await setScheme(page, "dark");
        await expectNoHorizontalScroll(page);
      });
    }
  }
});
