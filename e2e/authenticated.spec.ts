import type { Page } from "@playwright/test";
import {
  SCHEMES,
  expect,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  setScheme,
  test,
  visit,
  watchPage,
} from "./helpers";

// These tests sign in as a real, already onboarded test user and only read.
// They never delete the account, send an invite, create a report, ask the AI a
// question or change the password. They are skipped without credentials:
//   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... pnpm e2e
const email = process.env.E2E_USER_EMAIL;
const password = process.env.E2E_USER_PASSWORD;

test.skip(
  !email || !password,
  "Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run the signed-in tests.",
);

async function signIn(page: Page) {
  await visit(page, "/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // The test user must be onboarded: onboarding would redirect every page.
  expect(
    new URL(page.url()).pathname,
    "the E2E user must have finished onboarding",
  ).not.toMatch(/^\/onboarding/);
}

interface AppPage {
  name: string;
  path: string;
  heading: RegExp;
}

const APP_PAGES: AppPage[] = [
  { name: "dashboard", path: "/dashboard", heading: /^Hello/ },
  { name: "settings", path: "/settings", heading: /^Settings$/ },
  { name: "partner", path: "/partner", heading: /^Your partner$/ },
  { name: "ask", path: "/ask", heading: /^Ask AstraPair$/ },
];

test.describe("signed-in pages", () => {
  for (const entry of APP_PAGES) {
    test(`${entry.name}: renders, fits at 375px and passes axe in both themes`, async ({
      page,
    }) => {
      const watch = await watchPage(page);
      await signIn(page);

      await visit(page, entry.path);
      await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 1, name: entry.heading }).first(),
      ).toBeVisible();

      // The header must fit on a phone.
      await page.setViewportSize({ width: 375, height: 812 });
      await expectNoHorizontalScroll(page);
      const header = page.locator("header.app-topbar");
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      expect(box, "app header box").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(375);
      await expect(
        page.getByRole("button", { name: "Sign out" }),
      ).toBeInViewport();

      for (const scheme of SCHEMES) {
        await setScheme(page, scheme);
        await expectNoSeriousA11yViolations(
          page,
          `${entry.name} signed in (${scheme})`,
        );
      }

      expect(await watch.violations(), "CSP violations").toEqual([]);
      expect(watch.errors(), "console errors").toEqual([]);
    });
  }

  test("settings: the delete card is present and its dialog can be cancelled", async ({
    page,
  }) => {
    await signIn(page);
    await visit(page, "/settings");
    await expect(page.getByText("Delete account").first()).toBeVisible();
    await expect(
      page.getByText("This cannot be undone.").first(),
    ).toBeVisible();

    const trigger = page.getByRole("button", {
      name: "Delete account",
      exact: true,
    });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    const dialog = page.getByRole("alertdialog", {
      name: "Delete your account for good?",
    });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Focus moves into the confirmation.
    await expect(dialog.getByLabel("Type DELETE to confirm")).toBeFocused();

    // Cancel. The confirm button is never pressed, so nothing is deleted.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Escape also closes it.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Still signed in, still on settings.
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("settings: the delete dialog passes axe", async ({ page }) => {
    await signIn(page);
    await visit(page, "/settings");
    await page
      .getByRole("button", { name: "Delete account", exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    for (const scheme of SCHEMES) {
      await setScheme(page, scheme);
      await expectNoSeriousA11yViolations(
        page,
        `settings, delete dialog open (${scheme})`,
      );
    }
    await page.keyboard.press("Escape");
  });

  test("signed-in visitors are sent away from the sign-in page", async ({
    page,
  }) => {
    await signIn(page);
    await visit(page, "/login");
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("the account navigation links to every app page", async ({ page }) => {
    await signIn(page);
    await visit(page, "/dashboard");
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [label, href] of [
      ["Chart", "/chart"],
      ["Partner", "/partner"],
      ["Ask", "/ask"],
      ["Settings", "/settings"],
    ]) {
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });
});
