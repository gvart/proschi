# End-to-end tests

Browser tests for the three pages (landing, editor in `app/`, practice in
`practice/`), written with [Playwright](https://playwright.dev). They run
against `vite preview` of the **production build**, served under `/proschi/`
like GitHub Pages, so the relative asset base is exercised too.

```sh
cd frontend
npm ci
npx playwright install --with-deps chromium   # once per machine
npm run build
npm run build:accounts   # the same site with sign-in, in dist-accounts/
npm run e2e          # or: npm run e2e:build (both builds, then test)
```

- `npx playwright test editor` runs one file; `--headed` / `--ui` to watch.
- `npx playwright show-report` opens the HTML report; failures keep a trace
  (`npx playwright show-trace test-results/<test>/trace.zip`).
- `E2E_PORT` changes the preview port (default 4173; the build with accounts
  is served on the next port). A running preview on those ports is reused
  outside CI.
- `*.accounts.e2e.ts` run against the build with accounts (the `accounts`
  project); `accounts.ts` mocks a signed-in API with `page.route`.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` uses an already installed
  Chromium instead of Playwright's own (for sandboxes without network).

## What is covered

| File | Covers |
|---|---|
| `landing.e2e.ts` | Hero, hero player, practice list (26 problems), example links into the editor |
| `editor.e2e.ts` | Canvas, typing updates the diagram, diagnostics, Play and stepping, scenario tabs, share link round trip, Format code, HLD / Analysis / Tests tabs, PNG export, phone Code/Diagram tabs |
| `onboarding.e2e.ts` | First-run tours: shown on a first visit, Esc/X skip, interactive steps, not over share links (hint only), `?tour=` params, replay from Help, phone layout, storage blocked; cheat-sheet; starter for new diagrams |
| `practice.e2e.ts` | Problem list and its "Contribute a problem" links, url-shortener: starter fails, reference solution solves it, progress survives a reload, phone tab layout |
| `prep.e2e.ts` | The practice hub: the Today panel (streak, cards due, today's challenge and daily run, Continue) over the problem list, one bar of tabs with the header's Practice marked on every address, the Progress tab's level and sections, the account page with its compact badge grid, a public profile (API mocked) |
| `roadmap.e2e.ts` | Interview prep roadmap: entry from the hub's Roadmap tab, locked problems, Start, the banner on a problem, unlocking the next one after a solve, the list stays open |
| `challenge.e2e.ts` | Daily challenge (no accounts): the hub's Challenge tab, play, score, share, one attempt, resume after a reload, confetti, the next card's focus and scroll on a phone |
| `challenge.accounts.e2e.ts` | Signed in (API mocked): the challenge as the hub's tab, its leaderboard rows linking to public profiles, the challenge streak and best score on `#/me` and a public profile, every page at 320px and 360px |
| `problem-board.accounts.e2e.ts` | Signed in (API mocked): a problem's cheapest and lowest-p99 boards after a run, their rows linking to profiles, and your rank |
| `email.accounts.e2e.ts` | Signed in (API mocked): opting in to email reminders on `#/me` (address and browser time zone sent, waiting for the confirmation), a confirmed address's per-type switches, resuming after a pause, removing the address |
| `header.accounts.e2e.ts` | Signed in (API mocked): the header with the account and help menus fits a 320px and 390px phone on every practice page, and their panels open inside the screen; the desktop header keeps the account name and the editor button |
| `shell.e2e.ts` | Shared header and footer on every page, theme toggle persists and follows the system, phone menu |
| `focus.e2e.ts` | Editor focus theme (dark by default, light when chosen, kept after a reload), zen mode (Ctrl+., Escape, button, practice), the solve celebration and its absence under reduced motion |

## Conventions

- Files are named `*.e2e.ts` so vitest never picks them up.
- Every test fails on an uncaught page error or a `console.error` in any of
  its pages (`fixtures.ts`). Known-benign messages go in
  `ALLOWED_CONSOLE_ERRORS` with a comment saying why.
- A request to any other host fails the test: the site loads nothing from
  third parties (fonts are self-hosted), so the suite runs offline.
- Select by role, label or text. Add a `data-testid` only where those are not
  enough (today: the editor's diagnostics list).
- No fixed sleeps: wait for a condition (`expect(...)`, `expect.poll`).
  Layout is asynchronous, so use `waitForCanvas()` before touching nodes.
- Each test gets a fresh browser context, so `localStorage` starts empty,
  except that the first-run tours are marked as seen (`fixtures.ts`), so they
  never cover what a test looks at. Tour tests opt out with
  `test.use({ onboarding: 'fresh' })`.

CI runs the suite in the `e2e` job of `.github/workflows/site.yml`; the
Pages deploy waits for it. On failure the HTML report and traces are uploaded
as the `playwright-report` artifact.
