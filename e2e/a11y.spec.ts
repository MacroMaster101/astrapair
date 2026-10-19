import {
  PUBLIC_PAGES,
  SCHEMES,
  expect,
  expectNoSeriousA11yViolations,
  openMobileMenu,
  setScheme,
  test,
  visit,
} from "./helpers";

// Serious and critical axe violations fail; moderate ones are printed.
test.describe("accessibility of public pages", () => {
  for (const entry of PUBLIC_PAGES) {
    for (const scheme of SCHEMES) {
      test(`${entry.name} (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await visit(page, entry.path);
        await setScheme(page, scheme);
        await expect(
          page.getByRole("heading", { name: entry.heading }).first(),
        ).toBeVisible();
        await expectNoSeriousA11yViolations(page, `${entry.name} (${scheme})`);
      });
    }
  }

  test("landing page with the mobile menu open (375px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await visit(page, "/");
    await openMobileMenu(page);
    await expectNoSeriousA11yViolations(page, "landing, mobile menu open");
  });

  test("landing page with a FAQ answer open", async ({ page }) => {
    await visit(page, "/");
    await page
      .getByText("Is this a prediction about our relationship?")
      .click();
    await expect(page.getByText(/isn't a scientific prediction/)).toBeVisible();
    await expectNoSeriousA11yViolations(page, "landing, FAQ open");
  });

  test("login with an error message showing", async ({ page }) => {
    await visit(page, "/login?error=oauth_failed");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "login, error shown");
  });

  test("login with field errors showing", async ({ page }) => {
    await visit(page, "/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Email").press("Enter");
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "login, field errors");
  });
});
