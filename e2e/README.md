# End-to-end and accessibility suite

Playwright drives a real browser against a running copy of the app. It covers
the public pages, security headers, accessibility (axe) and, when credentials
are supplied, the signed-in pages.

## Run it

The suite does not start the app. Start it first, in another terminal:

```bash
pnpm dev                              # http://localhost:3000
# or, to test what ships:
pnpm build && pnpm start -p 3100      # http://localhost:3100
```

Then run the suite:

```bash
pnpm e2e                                          # against http://localhost:3000
E2E_BASE_URL=http://localhost:3100 pnpm e2e       # against another address
pnpm e2e e2e/a11y.spec.ts                         # one file
pnpm e2e -g "landing"                             # tests whose title matches
```

Windows PowerShell: `$env:E2E_BASE_URL = "http://localhost:3100"; pnpm e2e`.

## Environment variables

| Variable                              | Purpose                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`                        | Address of the running app. Default `http://localhost:3000`.                                                                      |
| `E2E_PROD=1`                          | The target is a production build. Turns on the checks that dev mode cannot pass: no `'unsafe-eval'` in the CSP, and HSTS present. |
| `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` | A test user that has finished onboarding. Without both, the signed-in tests are skipped.                                          |
| `E2E_BROWSER_CHANNEL`                 | Browser channel. Default `chrome`. Use `msedge` for Microsoft Edge.                                                               |
| `E2E_CHROME_PATH`                     | Path to a Chromium-based browser executable. Takes precedence over the channel.                                                   |

Use a dedicated test account, never a real person's. The signed-in tests only
read: they never delete an account, send an invite, create a report, ask the
AI a question or change the password. The settings test opens the delete
confirmation and cancels it.

## Why the Chrome channel

The config uses the installed Google Chrome (`channel: "chrome"`) so nobody has
to download a bundled browser. Do not run `playwright install`. If Chrome is
not installed, set `E2E_BROWSER_CHANNEL=msedge` or point `E2E_CHROME_PATH` at
any Chromium-based browser.

## What is in it

- `public.spec.ts`: landing page, sign in, sign up, password reset, legal
  pages, redirects of protected routes, invite not-valid states, `/api/health`,
  `/api/places` when signed out, the 404 page, the theme toggle, keyboard
  behaviour, and no horizontal scroll at 375, 768 and 1280 px in both themes.
- `headers.spec.ts`: the CSP (a fresh nonce per request, matching the nonce on
  the page's scripts), the static security headers, which paths skip the proxy,
  and no console errors or CSP violations on every public page.
- `a11y.spec.ts`: axe with the WCAG 2.0 and 2.1 A and AA tags on every public
  page in light and dark. Serious and critical findings fail the test.
  Moderate and minor findings are printed in the test output.
- `authenticated.spec.ts`: dashboard, settings, partner and ask for a signed-in
  user: no console errors, the header fits at 375 px, axe in both themes.

Tests are deterministic: reduced motion is on (the "CSP in the browser" group
turns it off so the landing page is watched with its animations, and one test
in `headers.spec.ts` watches the landing page with reduced motion on), they
wait on visible state rather than timers, and any request from the browser to
an origin other than the app fails the test. Clicks on controls that need
React (the mobile menu, tabs, the theme toggle) wait until the control is
hydrated and repeat until the control shows its effect, so a click that lands
too early cannot decide a result.

## Which run counts

Run the suite against a dev server only while nobody is editing files under
`src/`. The dev server pushes a refresh to open pages whenever a source file
changes, which can close a menu mid-test or log "Router action dispatched
before initialization" from Next.js itself. On a dev server the suite ignores
that error only when its stack also passes through the hot reload function
(`hmrRefresh`); the same message from any other source fails the test, and
with `E2E_PROD=1` it is never ignored, because the same code exists in
production builds. The run that counts
for a release is the production one: `pnpm build`, `pnpm start -p 3100`, then
`E2E_PROD=1 E2E_BASE_URL=http://localhost:3100 pnpm e2e`. If `E2E_PROD` does
not match the target, the CSP test fails and says so.

## Test results folder

A failing signed-in test saves a trace in `test-results/`, and that trace
contains the typed password and the session cookies. The folder is ignored by
git. Do not share, attach or upload it, and delete it when you are done.

## What is not covered

- The two-person funnel (invite a partner, accept, connect, shared report) needs
  two accounts and sends real email and invites. Walk through it with the
  manual checklist before a release.
- Asking the AI a question, creating a report, deleting an account and
  changing a password, because they cost money or cannot be undone.
- Signing in with Google, which leaves the app.
- Email delivery and the content of emails.
- Anything that needs a mobile device or screen reader; axe finds only part of
  what a person using assistive technology would.
