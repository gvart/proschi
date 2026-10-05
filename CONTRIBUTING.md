# Contributing to Proschi

Thanks for helping! Proschi is a text language for architecture diagrams with
a deterministic simulation, plus system design practice problems and review
cards at <https://proschi.app/>. The contributions we most want are **new
practice problems** and **new review cards**, and you don't need to touch the
language or the simulation to add either: a problem is a folder of plain
files and a card is one Markdown file.

Not up for writing one? [Suggest a problem](https://github.com/gvart/proschi/issues/new?template=problem-idea.md)
or [suggest a card](https://github.com/gvart/proschi/issues/new?template=card-idea.md)
instead.

- [Getting set up](#getting-set-up)
- [Checks before a pull request](#checks-before-a-pull-request)
- [Adding a new problem](#adding-a-new-problem)
- [Adding a new card](#adding-a-new-card)
- [Reporting issues and suggesting problems](#reporting-issues-and-suggesting-problems)
- [Code style and conventions](#code-style-and-conventions)

## Getting set up

You need Node 22 (CI's version; the CLI alone runs on Node 18 or newer) and
Git.

```sh
git clone https://github.com/gvart/proschi.git
cd proschi
(cd frontend && npm ci)
(cd backend && npm ci)
(cd tooling && npm ci && npm run build)   # builds the proschi CLI into tooling/dist/
```

The repository has three packages:

- `frontend/`: the site (React, Vite, TypeScript, Tailwind): the editor, the
  practice page and the docs. The language, simulation and HLD code are in
  `src/dsl`, `src/sim` and `src/hld`; the problems in
  `src/practice/problems/<id>/` and the cards in
  `src/practice/cards/<topic>/<id>.md`.
- `backend/`: the Cloudflare Worker (with D1) that serves proschi.app and the
  API for accounts and stats ([backend/README.md](backend/README.md)).
- `tooling/`: the `proschi` CLI, the language server and the VS Code
  extension, bundled from the frontend sources.

Run the site locally:

```sh
cd frontend
npm run dev     # http://localhost:5173/ (editor at /app/, practice at /practice/)
```

That is all you need for problems and cards: the dev server has no API, so
the practice page works signed out. To run the whole site with the API
(accounts, stats), see [Development in backend/README.md](backend/README.md#development).

The commands below use the CLI from the repository root as
`node tooling/dist/cli.cjs`; run `npm run build` in `tooling/` again after
you pull changes to the language or the checks.

## Checks before a pull request

CI runs these on every pull request; run the ones for the packages you
changed and get them green first.

```sh
# frontend/
npm run lint
npx tsc -b
npm test
npm run build
npx playwright test      # end-to-end tests, against the build above

# backend/
npm run typecheck
npm test

# tooling/
npm run typecheck
npm test
npm run build
node dist/cli.cjs problem check ../frontend/src/practice/problems
node dist/cli.cjs cards check ../frontend/src/practice/cards
node dist/cli.cjs achievements check
```

`npx playwright test` needs a browser once: `npx playwright install chromium`.
A new problem or card changes what the frontend, tooling and backend tests
see, so run all three suites for those.

## Adding a new problem

A problem is a folder in `frontend/src/practice/problems/<id>/`; the practice
page, the landing page and the static problem pages pick it up by
themselves. [docs/PRACTICE.md](docs/PRACTICE.md) is the full reference for
the format, the rules `problem check` enforces and calibration; this section
is the checklist.

1. **Pick an idea and check it isn't covered.** Look through the folders in
   `frontend/src/practice/problems/` and the [practice page](https://proschi.app/practice/).
   A good problem has one key idea that the simulation can tell apart from a
   tempting shortcut (a cache in front of the database, a queue instead of a
   synchronous call, a CDN instead of bytes through the API). Unsure? Open a
   [problem idea](https://github.com/gvart/proschi/issues/new?template=problem-idea.md)
   issue first.

2. **Scaffold it.** From the repository root:

   ```sh
   node tooling/dist/cli.cjs problem new seat-map
   ```

   This creates `frontend/src/practice/problems/seat-map/` with
   `problem.md`, `given.proschi`, `starter.proschi`, `solution.proschi` and
   `wrong/database-only.proschi`: a small, complete problem that already
   passes the check. The id is the folder name and the URL
   (`practice/#/seat-map`): lowercase words joined by `-`.

3. **Write the files** ([the format](docs/PRACTICE.md#problemmd)):
   - `problem.md`: front matter (title, summary, difficulty, tags, hints,
     optionally `company` and `order`) and the statement, with
     `## Functional requirements` naming every use case in **bold**, then
     scale, constraints and what is given.
   - `given.proschi`: the fixed nodes, the `traffic`, the `requirements`,
     any `capacity` the problem needs (only the given may set it) and the
     `test` blocks that encode the key insight.
   - `starter.proschi`: `import "problem.proschi"` and a small valid start
     that fails at least one test.
   - `solution.proschi`: the reference answer, passing every requirement and
     test with no warnings, in canonical format
     (`node tooling/dist/cli.cjs fmt <file>`).
   - `lesson.md`: the lesson shown before the problem, with
     [the eight sections](docs/PRACTICE.md#lessonmd) in order, original prose
     and sources under *Further reading*. The scaffold doesn't create it, and
     the frontend tests fail until it exists.

4. **Calibrate with wrong designs.** Measure the reference solution, write
   the brute-force designs a candidate would try, and set each limit between
   them ([calibrating](docs/PRACTICE.md#calibrating-a-problem)). Replace the
   example `wrong/database-only.proschi` with those designs, each starting
   with `# expect-fail:` lines naming the requirements or tests it must fail.

5. **Check it:**

   ```sh
   node tooling/dist/cli.cjs problem check
   ```

   It prints each wrong design's failures (handy for the `# expect-fail:`
   lines) and exits with 1 on any violation. Then open
   `http://localhost:5173/practice/#/seat-map` in `npm run dev` and solve it
   as a solver would.

6. **Update the hard-coded problem counts.** A few tests and pages state the
   number of problems; each must go up by one:
   - the landing page, `frontend/index.html`: "25 system design problems";
   - the e2e tests: `frontend/e2e/practice.e2e.ts` ("lists 25 problems",
     `toHaveCount(25)`, "0 of 25 solved", "1 of 25 solved"),
     `frontend/e2e/landing.e2e.ts` ("practice list shows 25 problems",
     `toHaveCount(25)`) and the table in `frontend/e2e/README.md`;
   - the practice tests: `frontend/src/practice/practice.test.ts`, its
     `toBeGreaterThanOrEqual(25)` and the ordered list of ids in "lists
     problems by difficulty, then order, then title" (put the new id where
     the sort puts it);
   - the tooling test: `tooling/test/problem.test.ts` ("25 problems, …");
   - the sample output in `docs/PRACTICE.md` ("25 problems, 86 wrong
     designs").

   This finds them all (with today's count, 25):

   ```sh
   git grep -nE "\b25 (problems|system)|of 25 solved|\(25\)" -- frontend/index.html frontend/e2e frontend/src/practice tooling/test docs/PRACTICE.md
   ```

7. **Place it on the roadmap, and link cards (optional).** Every problem
   must appear exactly once in a stage of `ROADMAP` in
   `frontend/src/practice/roadmapStages.ts` (`roadmap.ts` explains the
   order: after the ideas it builds on, easier first), or `npm test` fails.
   Cards that prepare for the problem can name it in their front matter:
   `related: [seat-map]`.

8. **Changelog and pull request.** Add a line under `## [Unreleased]` →
   `### Added` in [CHANGELOG.md](CHANGELOG.md), run the
   [checks](#checks-before-a-pull-request), and open a pull request. Pull
   requests are squash-merged, so the title becomes the commit message.

## Adding a new card

Cards are the short questions of daily review (`practice/#/review`). Each is
one Markdown file, `frontend/src/practice/cards/<topic>/<id>.md`.
[docs/CARDS.md](docs/CARDS.md) is the full reference: every field, the
types, the length limits and how to write a good card.

1. **Pick a topic and check the idea is new.** The topics, and so the
   folders, are listed in `frontend/src/practice/cards/tags.json` (caching,
   sharding, estimation…). Search for the idea by keyword, e.g.
   `git grep -il "stampede" frontend/src/practice/cards`; the check in step 5
   also flags near-duplicates.

2. **Create the file**, `frontend/src/practice/cards/<topic>/<id>.md`. The
   file name is the card's permanent id: lowercase words joined by `-`,
   unique across topics, saying what the card asks (`cache-stampede`,
   `three-nines-downtime`).

3. **Write the front matter and the sections for its type.** The front
   matter has `type` and `difficulty` (`easy`, `medium` or `hard`), and
   optionally `tags` (other topics), `related` and `decks`. Every type may
   end with `## Why`, shown after answering. One short example of each
   ([the types in full](docs/CARDS.md#card-types)); these ideas are already
   cards, so the check would flag copies of them:

   **flip**: think of the answer, flip, rate yourself.

   ```markdown
   ---
   type: flip
   difficulty: medium
   ---

   ## Front

   Why use consistent hashing instead of `hash(key) % N` to pick a shard?

   ## Back

   With `% N`, adding a server remaps almost every key; with consistent
   hashing only about 1/N of the keys move.
   ```

   **choice**: 2–6 options, exactly one marked `[x]` (they are shuffled).

   ```markdown
   ---
   type: choice
   difficulty: easy
   ---

   ## Question

   Which cache write policy can lose acknowledged writes if the cache crashes?

   ## Options

   - [ ] Write-through
   - [x] Write-back
   - [ ] Write-around
   ```

   **estimate**: a number, right within a factor of `tolerance` (default 2),
   with the worked `## Solution`.

   ```markdown
   ---
   type: estimate
   difficulty: easy
   answer: 2300
   unit: requests/s
   ---

   ## Question

   10 million daily users make 20 requests a day each. What is the average load?

   ## Solution

   10M × 20 = 200M a day; ÷ 86,400 s ≈ **2,300 requests/s**.

   Numbers: [Numbers to know](../docs/numbers/#per-day-to-per-second).
   ```

   **cloze**: 1–3 gaps written `{{answer}}`, alternatives after `|`.

   ```markdown
   ---
   type: cloze
   difficulty: easy
   ---

   ## Text

   When many requests miss a hot key at once, it is a {{cache stampede|thundering herd}}.
   ```

4. **Link related problems and numbers.** Add `related: [url-shortener]`
   with the ids of the practice problems the card prepares for, so the
   practice page can suggest it before and after them. An estimate card
   takes its round numbers from [Numbers to know](docs/NUMBERS.md) and ends
   its `## Solution` (or `## Why`) with a link to the section it draws on,
   as in the example above: `Numbers: [Numbers to know](../docs/numbers/#<section>).`
   The link is relative to the practice page, where cards are shown, and a
   docs test checks that the anchor exists.

5. **Lock and check.** From the repository root:

   ```sh
   node tooling/dist/cli.cjs cards lock    # adds the new id to ids.lock; commit it with the card
   node tooling/dist/cli.cjs cards check
   ```

   A new card fails the check until it is locked. If the check reports a
   "possible duplicate" (two cards whose words overlap 40% or more),
   reword yours so it asks
   something different, merge the two, or, if they really test different
   things, add `distinct-from: [<other id>]` to the new card.

6. **Never delete or rename a card.** Review history is stored by id. To
   remove a card, set `status: retired` and keep the file; to move it to
   another topic, move the file and keep its name. Bump `version` only when
   the **answer** changes (people who learned the old one see it again);
   typo fixes and rewording keep it.

7. **Changelog and pull request.** Add a line under `## [Unreleased]` in
   [CHANGELOG.md](CHANGELOG.md), run the
   [checks](#checks-before-a-pull-request), and open a pull request.

Have a card idea or found a wrong answer, but don't want to write the file?
[Suggest a card](https://github.com/gvart/proschi/issues/new?template=card-idea.md).

## Reporting issues and suggesting problems

- **Bugs and other ideas:** [open an issue](https://github.com/gvart/proschi/issues/new)
  with what you did, what you expected and what happened (a share link from
  the editor helps).
- **A problem idea, no code needed:** use the
  [problem idea template](https://github.com/gvart/proschi/issues/new?template=problem-idea.md):
  the system, its key idea, the use cases and the scale.
- **A card idea or a wrong card:** use the
  [card template](https://github.com/gvart/proschi/issues/new?template=card-idea.md).

## Code style and conventions

- TypeScript everywhere, linted with ESLint (`npm run lint` in
  `frontend/`). Follow the style of the code around your change.
- A change to the language goes in `frontend/src/dsl/` with tests next to
  it; the tooling and the backend bundle the same code, so all three test
  suites must pass.
- Proschi files are in canonical format (`node tooling/dist/cli.cjs fmt`).
- Docs and prose: short sentences, plain words, real numbers. Problem
  lessons and cards are original writing; cite sources, don't copy them.
- Pull requests are squash-merged. Add user-facing changes to
  [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`.
- A new problem changes the hard-coded problem counts
  ([step 6 above](#adding-a-new-problem)).
- By contributing you agree that your work is released under the
  [MIT license](LICENSE).
