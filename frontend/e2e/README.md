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
npm run e2e          # or: npm run e2e:build (build, then test)
```

- `npx playwright test editor` runs one file; `--headed` / `--ui` to watch.
- `npx playwright show-report` opens the HTML report; failures keep a trace
  (`npx playwright show-trace test-results/<test>/trace.zip`).
- `E2E_PORT` changes the preview port (default 4173). A running preview on
  that port is reused outside CI.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` uses an already installed
  Chromium instead of Playwright's own (for sandboxes without network).

## What is covered

| File | Covers |
|---|---|
| `landing.e2e.ts` | Hero, hero player, practice list (12 problems), example links into the editor |
| `editor.e2e.ts` | Canvas, typing updates the diagram, diagnostics, Play and stepping, scenario tabs, share link round trip, Format code, HLD / Analysis / Tests tabs, PNG export, phone Code/Diagram tabs |
| `onboarding.e2e.ts` | First-run tours: shown on a first visit, Esc/X skip, interactive steps, not over share links (hint only), `?tour=` params, replay from Help, phone layout, storage blocked; cheat-sheet; starter for new diagrams |
| `practice.e2e.ts` | Problem list, url-shortener: starter fails, reference solution solves it, progress survives a reload, phone tab layout |

## Conventions

- Files are named `*.e2e.ts` so vitest never picks them up.
- Every test fails on an uncaught page error or a `console.error` in any of
  its pages (`fixtures.ts`). Known-benign messages go in
  `ALLOWED_CONSOLE_ERRORS` with a comment saying why.
- External requests (Google Fonts) are stubbed; the suite runs offline.
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
