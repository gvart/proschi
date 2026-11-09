# Feature expansion: tier value, language, visual editor

Temporary implementation doc. Tick items as they land. Delete this file in the
final change that completes the work.

## Goal

Give Free, Pro and Max more value at the same prices (nothing that adds a
per-use LLM cost), and improve the language and the visual editor.

## Decisions

- Prices stay the same. New paid value runs in the browser or is static, so it costs nothing per use.
- Gating follows the existing pattern: a new ID in
  `frontend/src/services/featureContract.ts` and a plan in
  `backend/src/features.ts`, gated in the UI through
  `frontend/src/components/featureState.ts`. It must behave correctly in all three builds
  (`build`, `build:accounts`, `build:accounts-free`).
- Tiers:
  - **Free:** basic what-if (slider, simulate down) and rule-based next steps.
  - **Pro:** design diff with sim deltas, sweeps and saved what-ifs, interview history with solo trends, data export and pro exports.
  - **Max:** PDF interview report, interview-date plan and mastery certificate.
- **Language changes:** each one updates `docs/GRAMMAR.md` or the relevant docs page, the formatter, the
  language server and `frontend/src/docs/model.html` (if the sim model changes).
- `Playground.tsx` is split first so that parallel editor work does not collide.
- Out of scope: pricing changes and share-link extras (password, expiry, comments).

## Work items

### Iteration 1: groundwork
- [x] **1.1 Split Playground**: move `DiagramView` and `FilesRail` out of
  `frontend/src/components/Playground/Playground.tsx` into their own files. No
  behaviour change.
  verify: lint, tsc, unit tests, full e2e green. depends on: none

### Iteration 2: quick wins
- [x] **2.1 T1 Ungate history and report**: remove `interview_history` and
  `interview_report` from `METERED` in `featureState.ts`. Extend history to solo
  interviews (`practice/history/SoloHistory.tsx`, `SkillTrends.tsx`,
  `backend/src/soloInterviews.ts`) and make the report printable for solo verdicts.
  verify: feature-state unit tests, e2e for Pro (history) and Max (report) gating. depends on: none
- [x] **2.2 L1 Editor quick wins** (`tooling/src/server.ts`, `analysis.ts`, and the web
  `CodeEditor` where shared):
  - rename for node ids, use cases and scenarios;
  - completion of quoted use case and scenario names after `traffic`/`mix`/`p99 "`/`scenario "`, plus `capacity` keywords;
  - quick fixes: add a traffic line, add `x2` on a single point of failure, add `shards N` from the saturation hint, remove a duplicate capacity part.
  verify: tooling tests per feature. depends on: none
- [x] **2.3 E3 Canvas editing basics**:
  - copy, paste and duplicate (Ctrl+C/V/D), including the edges between the selected nodes;
  - edge reconnect (`onReconnect` → new `retargetConnection` in `dsl/edit.ts`);
  - right-click menu: Duplicate, Rename, Connect to…, Jump to code, Unpin;
  - node search on the canvas (reuses `QuickOpen`);
  - a toggleable minimap;
  - a `?` shortcut sheet.
  verify: `dsl/edit` unit tests, `visual-editing.e2e.ts` additions. depends on: 1.1

### Iteration 3: simulation visibility
- [ ] **3.1 E1 Two-way selection sync**: a canvas selection selects its source `loc` in
  the code editor, and a cursor on a declaration highlights the node.
  verify: e2e both directions. depends on: 1.1
- [ ] **3.2 E2 Sim on canvas**:
  - rps and latency on edges, edges tinted by load (`sim/overlay.ts`, `RoutedEdge.tsx`);
  - the bottleneck node and the p99 path highlighted, and clicking one in Results focuses it on the canvas;
  - the overlay on by default when there's a `traffic` block, with a legend.
  verify: overlay unit tests, e2e. depends on: 1.1
- [ ] **3.3 L2 Inline sim results**: inlay hints in the language server (`62% · $400/mo` after each node)
  and code lens (`p99 38 ms ✓` above each use case). Mirror them in the web editor if cheap.
  verify: tooling tests. depends on: none

### Iteration 4: what-if and diff
- [x] **4.1 T3 What-if language**: a `whatif "Name" { traffic "X" x3; fail cache; db x4 }`
  block that is parsed, formatted, simulated (`AnalyzeOptions`) and checked against
  `requirements`. The CLI gets `proschi analyze --whatif` and `--sweep "UC" 10k..500k`
  (prints where each node saturates and the max rps that still passes).
  verify: dsl and sim tests, tooling tests, docs page. depends on: none
- [ ] **4.2 T3 What-if UI**:
  - a traffic multiplier slider on the overlay that doesn't edit the text, plus a "write to traffic" button;
  - "Simulate down" in the right-click menu;
  - saved `whatif` blocks shown as tabs in Results (Pro).
  verify: e2e, Free vs Pro gating. depends on: 2.3, 3.2, 4.1
- [ ] **4.3 T2 Design diff with sim deltas**: a versions diff in the UI showing cost, p99 and
  which checks pass before and after (Pro). A new `proschi diff a.proschi b.proschi` in the CLI.
  verify: unit tests on the delta function, tooling tests, e2e. depends on: none

### Iteration 5: learning value
- [x] **5.1 T4 Rule-based next steps** (Free): built from mastery, mistakes and due cards
  (`learn/mastery.ts`, `practice/mistakes.ts`, `practice/history/NextForYou.tsx`).
  verify: unit tests on the recommender. depends on: none
- [ ] **5.2 T5 Interview-date plan** (Max): pick a date and get a daily schedule of
  problems, cards and drills, with reminders (`practice/hub/goal.ts`, `backend/src/reminders.ts`).
  verify: schedule unit tests, backend tests, e2e. depends on: 5.1
- [ ] **5.3 T6+T7 Export and proof**:
  - a JSON/CSV data export (Pro);
  - a mastery certificate (Max: a shareable page and image via `backend/src/og.ts`);
  - Pro exports: no watermark on embeds, high-DPI PNG, PDF of the HLD.
  verify: unit and e2e tests, gating in all builds. depends on: none

### Iteration 6: practice canvas parity
- [ ] **6.1 E4**: the practice `EditableCanvas` gets pinning, the load overlay and Auto-layout.
  The main editor gets the Flows builder. Share code with the extracted `DiagramView`.
  verify: practice and editor e2e. depends on: 1.1, 3.2

### Iteration 7: simulation model upgrades (one at a time, in order)
- [ ] **7.1 Constants**: `let peak = 120k rps`, used in traffic, replicas and budgets.
- [ ] **7.2 Peak and daily-profile traffic**: `"Read" 20k rps peak x3` or `profile 2k..60k rps`.
  Cost is taken at the average, capacity at the peak.
- [ ] **7.3 Cache hit rate**: `capacity { cache hit 90% }` derives the miss path's load.
- [ ] **7.4 Cost per team, group or tag**, plus scoped budgets `cost "@Payments" <= 500 usd/month`.
- [ ] **7.5 Retries and partial failure**: `errors 2% retries 3` adds retry amplification.
- [ ] **7.6 Queue backlog**: `drain 5k rps` and a `lag "UC" < 30s` requirement.

For each: parser, formatter, language server, sim tests and docs (GRAMMAR, HLD, model.html).
verify: dsl, sim and tooling tests, plus `problem check` across all problems (no regressions).
depends on: 4.1 (the what-if code path).

## Risks

- Iteration 7 changes simulation results. Practice-problem grading and the game must
  not shift: run `problem check` and the game check after each item.
- New gated features need their stories in the accounts-free build (paid
  features hidden while billing is off, the same as b62181cb).
- E3 and E1 both touch canvas selection, so land them one after the other.
