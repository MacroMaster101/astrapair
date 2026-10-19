import { defineConfig } from "@playwright/test";

// The suite does not start the app: run `pnpm dev`, or
// `pnpm build && pnpm start -p 3100`, first. See e2e/README.md.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// "chrome" is the installed Google Chrome, so no browser is downloaded. Use
// E2E_BROWSER_CHANNEL=msedge for Microsoft Edge, or E2E_CHROME_PATH for a
// Chromium-based browser at a custom location.
const channel = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
const executablePath = process.env.E2E_CHROME_PATH;

export default defineConfig({
  testDir: "e2e",
  // A dev server compiles each route on first request, which can be slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    // Animation timing must never decide a result.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: executablePath
        ? { browserName: "chromium", launchOptions: { executablePath } }
        : { browserName: "chromium", channel },
    },
  ],
});
