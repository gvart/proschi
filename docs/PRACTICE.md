# Writing practice problems

The practice page (`frontend/practice/`, code in `frontend/src/practice/`)
serves system design problems. Each problem is a folder of plain files in
`frontend/src/practice/problems/`; there is nothing to register. The practice
page, the landing page's list and `proschi problem check` all read the same
folders. The idea behind the format is in
[the design](design/hld-and-practice.md#53-practice-platform-practice).

Contributing a problem? [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-new-problem)
has the step-by-step checklist, from scaffolding to the pull request; this
page is the reference for the format.

## Folder layout

```text
frontend/src/practice/problems/<id>/
  problem.md            front matter + the statement (Markdown)
  given.proschi         the problem as Proschi, read-only for the solver
  starter.proschi       starts with: import "problem.proschi"
  solution.proschi      the reference solution; starts with the same import
  lesson.md             optional: the lesson shown before the problem
  interview.md          optional: interview mode's questions and estimates
  guided.md             optional: guided mode's steps (roadmap stage 1 only)
  wrong/<name>.proschi  optional: plausible wrong designs that must fail
```

The folder name is the problem id and its URLs: `practice/#/url-shortener` in
the practice app, and `practice/url-shortener/`, a static page with the title,
summary, statement and lesson (not the hints) that search engines index and
the sitemap lists. Lowercase letters and digits, words joined by `-`; `problem`
is taken by that page's template, and `roadmap`, `approach`, `review` and `progress` by
practice pages of their own (`RESERVED_IDS` in `problemFiles.ts`). Other files are an error,
so a typo like `solutoin.proschi` is caught. Wrong design names follow the same
rule (`wrong/miss-never-fills-cache.proschi`).

## `problem.md`

```markdown
---
title: URL Shortener
summary: Cache-first redirects that survive losing any single machine.
difficulty: easy
tags: [caching, read-heavy, durability]
order: 1
hints:
  - Redirects outnumber shortening 100 to 1. What can answer a redirect without touching the database?
  - "One instance of anything is a single point of failure: use x2 or more on every component."
---

Design a service that turns long URLs into short codes …

## Functional requirements
…
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Shown in the list and on the problem page |
| `summary` | yes | One line, shown on the landing page |
| `difficulty` | yes | `easy`, `medium` or `hard` |
| `tags` | yes | A list of strings, used by the list's tag filter |
| `company` | no | A string, e.g. `Twitter`: the company whose published system the problem is based on, cited in a `## Based on` section of the statement. It says where the design comes from, never that the company asks the problem in its interviews. The list shows it as a badge and filters by it (only companies some problem names); the problem page and its static page show the badge |
| `order` | no | A number: the position within its difficulty |
| `hints` | yes | A list, from a nudge to nearly the answer; the page reveals them one at a time |
| `version` | no | A whole number, 1 when absent. Bump it when a change to the given, the tests or the requirements can change whether a design solves the problem, or its cost or p99: proschi.app's global stats then count only solves of the new version, and a signed-in user's next run starts their stats for the problem over |

The list is sorted by difficulty (easy first), then `order` (problems without
one come after those with one), then title.

The front matter is a strict subset of YAML: `key: value` lines, `#` comment
lines, lists either as `[a, b]` on one line or as `  - item` lines under a
key with no value. A value is a plain string, a `"double-quoted"` string (JSON
escapes), a `'single-quoted'` string (`''` for a quote) or a number. A plain
value that YAML could read differently is an error with its line number:
quote it when it contains `: ` or ` #`, starts with one of
``- ? : , [ ] { } # & * ! | > ' " % @ ` `` or reads as `true`, `no`, `null` and
the like. Unknown fields and duplicate keys are errors too.

The **statement** is everything after the closing `---` (surrounding blank
lines are dropped). It says what to build: a short context, then
`## Functional requirements` (name every use case in bold, e.g.
`**Redirect**`, and the scenario names the tests refer to), `## Scale`,
`## Constraints` and `## What is given`. The renderer
(`frontend/src/practice/markdown.ts`) understands headings, paragraphs, bullet
and numbered lists (one level of nesting), fenced code (```` ```proschi ````
blocks, also ```` ```proschi fragment ````, are highlighted), GFM pipe tables
(they scroll in their own box on phones), `>` blockquotes (shown as a
callout), `inline code`, **bold**, *italics* and links; HTML is shown as
text. Headings get ids from their text, GitHub style
(`## What you'll learn` is `what-youll-learn`).

## `lesson.md`

The lesson teaches the ideas behind the problem before the solver tries it:
each roadmap step is *Learn → Challenge → Review*. A problem opened from the
roadmap (`practice/#/roadmap/<id>`) shows its lesson first, with a table of
contents and a **Start the challenge** button; once that was pressed the
browser remembers it and later visits open the problem;
`practice/#/roadmap/<id>/lesson` always opens on the lesson. On the roadmap a
step's lesson is locked like its challenge (until every earlier step is
solved, and signed out): the address of a locked step shows the roadmap with
what unlocks it. From the list the lesson is a tab next to the statement, and
`practice/#/<id>/lesson` opens on it; these lessons need no sign-in. The static page `practice/<id>/` shows the
lesson under the statement as an article with heading anchors, and the
roadmap shows each step's reading time (about 200 words a minute).

It is plain Markdown, no front matter, with these level-2 headings in this
order (other `##` sections may sit between them, and `###` subsections are
welcome, especially under Concepts):

```markdown
## What you'll learn
## The problem, explained
## Back-of-the-envelope
## Concepts
## Designing it step by step
## Common mistakes
## In the interview
## Further reading
```

`proschi problem check` and the tests report a missing or out-of-order
heading, an empty lesson, and any link that is not `http://` or `https://`
(no relative links: the same text is shown in the app and on the static
page). Every problem needs a lesson; `LESSONS_PENDING` in
`frontend/src/practice/lesson.test.ts` lists the ones still being written,
and the test fails once a listed problem has one, so remove its id then.

Writing a good lesson (1,500 to 2,500 words; `url-shortener/lesson.md` is an
example):

- **Write original prose.** Explain in your own words; never copy text from
  books, courses or other sites. Quote nothing longer than a phrase.
- **Cite your sources** under *Further reading*: links to freely available
  material (the [System Design Primer](https://github.com/donnemartin/system-design-primer),
  official documentation, engineering blogs, papers), and books by author,
  title and chapter title, without links to copies.
- **Teach the why.** Do the estimation with numbers from the statement, and
  for every concept say what problem it solves and what it costs.
- **Explain why each wrong design fails**, under *Common mistakes*: the
  shortcut, what breaks, and which requirement or test catches it (the
  `wrong/` designs are a good list).
- **Do not paste the reference solution.** Describe the design step by step
  and its trade-offs; a ```` ```proschi fragment ```` may illustrate a
  pattern on a different example, but the solver writes the design.
- Prefer short paragraphs, tables for numbers and a `>` callout for the one
  sentence to remember.

## `interview.md`

Interview mode is an opt-in toggle on the problem page. It runs a timed
interview (30, 45 or 60 minutes, pausable) in four phases: **Clarify** (the
statement without its `## Scale` and `## Constraints` sections, and a list
of clarifying questions to pick from), **Estimate** (back-of-the-envelope
questions graded against a range, then the worked answer), **Design** (the
normal editor and tests, the clock still running) and **Wrap-up** (a
self-review checklist and a summary). The session, time per phase and the
summaries stay in the browser; nothing is sent to the server.

Every problem has an `interview.md` (`interviewFile.test.ts` fails without
one). It holds exactly two sections, each item a `### ` heading opened by
`- key: value` lines and followed by Markdown:

```markdown
## Questions

### How many redirects a second at peak?
- kind: good
- fact: Redirects: 10k rps

About **10k redirects a second**: reads outnumber writes 100 to 1.

### Can I use Kubernetes?
- kind: weak

Deployment tooling is not what is assessed; ask about load and constraints.

## Estimates

### If the cache answers 95% of redirects, how many reach the database each second?
- answer: 500
- unit: reads/s
- range: 400 to 650

10,000 × 5% = **500 reads a second**.
```

- **Questions**: up to 12, at least 3 `good` and 2 `weak` (aim for about 5
  and 3). A good question's `fact` is words copied from the statement's
  Scale or Constraints section (compared ignoring case, spaces and `*`, `_`,
  `` ` ``); its text is the interviewer's answer. A weak question has no
  `fact`; its text says why it is weak and what to ask instead. The page
  shows the questions in a fixed shuffled order.
- **Estimates**: 1 to 4 (aim for 2 or 3). `answer` is a number above 0
  (`2300`, `2.3k`, `5M`, `1.6T`), `unit` says what it counts, and `range:
  <low> to <high>` gives the accepted answers around it; `tolerance: <factor>`
  (1.1 to 10) may replace the range, and without either the answer within a
  factor of 2 counts. The text is the worked answer, from the statement's
  numbers. The phase links the Numbers to know page.

## `guided.md`

Guided mode is an optional side panel on the roadmap's first stage
(`ROADMAP[0]` in `roadmapStages.ts`): each of those problems has a
`guided.md`, and no other problem does (`guidedFile.test.ts`). Each step is
a `## ` heading, its checkpoint as `- key: value` lines, then a short
explanation in Markdown:

```markdown
## Store every code in a database
- node: any database
- edge: any service -> any database
- test: Codes are stored before they are returned

A code that only lives in the API's memory is gone when that machine restarts…
```

Checks, any number per step and at least one, all of which must pass:

| Check | Passes when |
| --- | --- |
| `- node: <node>` | a node matches |
| `- edge: <node> -> <node>` | a connection or a use case step goes from one to the other |
| `- usecase: <name>` | the design defines that use case |
| `- replicas: <node> x<n>` | a node matches, and every match has at least n replicas (n ≥ 2) |
| `- test: <name>` | that requirement or test passes (runs the simulation) |

A `<node>` is an id (`visitor`) or `any <kind>` (`any cache`), as in tests.
"Check my design" runs the current step's checks on the editor's design and
unlocks the next step when all pass; a step can be skipped. Progress is
kept in the browser. Write 2 to 10 steps that build from the starter to the
reference solution, the last ones usually the requirements.

## The Proschi files

**`given.proschi`** is the problem as Proschi. The editor resolves
`import "problem.proschi"` to it, so it is merged into whatever the solver
writes:

- `title "Name" "Summary"`
- the fixed nodes the solver connects to: the client, and any existing system
  the problem is about (`orders "Orders API" [REST API] x5`)
- `traffic { … }` with the rate of every use case and the scenario mix
- `requirements { … }`: latency, availability, durability, failure and cost
- `capacity { … }` when the problem needs non-default numbers for a node
  (a slow external gateway, a provider's rate limit). Only the given may set
  capacity; see [the capacity rule](#the-capacity-rule).
- `test "…" { … }` blocks that encode the key insight of the problem, e.g.
  *the cache is read before the database*, *rejected calls never reach the
  backend*

No `import` inside the given.

**`starter.proschi`** begins with `import "problem.proschi"` and gives a
small, valid start: usually one use case with its first step.

**`solution.proschi`** is a complete design that passes every requirement and
test, written like a good answer: replicas sized for the traffic, `entity`
blocks, `decision` blocks that explain the trade-offs, and `when` conditions
on the scenarios. The page shows it after solving, or before with a
confirmation.

**`wrong/<name>.proschi`** is a plausible wrong design: the mistake a
candidate would make, usually the reference solution with one change. It
starts with one or more `# expect-fail:` lines naming, exactly, the
requirements or tests it must fail; other comment lines may follow; then the
import:

```proschi fragment
# expect-fail: Misses fill the cache
# A cache miss that never fills the cache.
import "problem.proschi"
…
```

Test names are the `test "…"` names, and for requirements the name the test
panel shows, such as `p99 of Redirect < 100 ms`, `cost ≤ $3,000/month` or
`survive any node failure` (`proschi problem check` prints each wrong
design's failures, which is the easiest way to copy them).

## What `problem check` enforces

`proschi problem check` and the frontend test suite apply the same rules,
defined once in `frontend/src/practice/validate.ts`:

- The folder has the four files and nothing unexpected; the front matter has
  valid fields; the statement is not empty and has a
  `## Functional requirements` section.
- **lesson.md**, when there is one: the eight sections in order, not empty,
  links to http(s) addresses only.
- **interview.md**, when there is one: only `## Questions` and
  `## Estimates`; enough good and weak questions, each good one with a
  `fact` found in the statement's Scale or Constraints; each estimate with a
  numeric `answer`, a `unit`, a range around the answer and a worked answer.
- **guided.md**, when there is one: 2 to 10 steps, each with valid checks
  and an explanation; ids, use cases and tests the problem has; and every
  check passing on the reference solution.
- Every use case in the given's `traffic` is named in bold in the statement
  and defined (`usecase "…"`) by the solution.
- **given**: no `import`, parses without errors, in canonical format
  (`proschi fmt`).
- **solution**: starts with the import, has no diagnostics at all (not even
  warnings), is in canonical format and passes every requirement and test.
- **starter**: starts with the import, has no errors, and fails at least one
  test.
- **each wrong design**: has at least one `# expect-fail:` line, the import
  right after the comments, no errors, and fails every test it names. Tests
  it fails without naming them are listed, not violations.

```sh
proschi problem check                                 # inside the repository: frontend/src/practice/problems
proschi problem check path/to/problems                # any problems directory
proschi problem check --format github                 # an annotation per violation, for CI
proschi problem check --format json                   # every report, with what each wrong design fails
```

```
✓ url-shortener: 10 tests, the starter fails 8, 1 wrong design, interview (9 questions, 3 estimates), guided (6 steps)
    wrong/miss-never-fills-cache: fails "Misses fill the cache"
…
25 problems, 86 wrong designs: no violations
```

It exits with 1 on any violation. `npm test` in `frontend/` runs the same
checks on every problem and every wrong design.

## The capacity rule

The simulation believes `capacity` lines, so a solution could otherwise write
`capacity { db 1m rps cost 1 usd/month }` and pass any load and budget. When
a design is evaluated against a problem (the practice page,
`proschi problem check`, the frontend tests), capacity is taken from the given
only: a `capacity` line in the solver's file, and so in the starter, the
solution or a wrong design, is an error, *capacity is set by the problem;
change the design (replicas, shards, caching) instead*, and the simulation
ignores it.

One part stays with the solver: `shards <n>`. How many shards a store is split
into is a design decision (each shard is a full set of replicas, and costs
like one), so `capacity { db shards 2 }` in the solver's file is accepted and
used. Everything else (rates, latency, availability, cost, durability,
consistency, bandwidth, egress, timeout) belongs to the problem: a solver who
set `timeout 1ms` would pass every failure scenario. Regular documents in
the editor and `proschi check`/`proschi test` are not affected.

## Calibrating a problem

A problem is good when the intended design passes and the tempting shortcuts
do not, and the limits in `requirements` decide that:

1. Measure the reference solution: open the problem in `npm run dev` and use
   *Show reference solution* and the *Analysis* tab, or on the command line
   copy `given.proschi` to `problem.proschi` in a scratch folder next to the
   design and run `proschi analyze solution.proschi`. Note its p99 per use
   case, its cost and its availability.
2. Write the brute-force designs a candidate might try: no cache, everything
   in one database, bytes through the API, a load balancer instead of a CDN,
   twice the replicas. Note their numbers too.
3. Put each limit between the two: loose enough that the reference passes
   with room (a design that is right should not fail on a rounding change),
   tight enough that the brute-force design fails. If they are too close,
   change the scale (traffic, payload sizes) until the key idea makes a clear
   difference.
4. Prove it: add each brute-force design as `wrong/<name>.proschi` with the
   tests it must fail in `# expect-fail:` lines. Flow tests catch the designs
   numbers cannot (the cache read after the database, a call that waits for
   a queue).

When the simulation's model changes, `problem check` shows which problems
need recalibrating. [How the simulation works](https://proschi.app/docs/model/)
lists every formula and default number the limits are measured against, and
explains to solvers what a passing verdict does and does not mean.

## Use case and scenario names

Traffic, requirements and tests refer to use cases and scenarios by name, so
the statement must spell out the exact names (`"Cache hit"`, `"Cache miss"`)
and the solver must use them. The test messages name what is missing when they
do not match.

## The interview prep roadmap

`practice/#/roadmap` is a guided path through the problems, in stages from
foundations to large systems. Each step is the problem's lesson, then the
problem; above the stages, a "Read first" article,
`frontend/src/practice/guide/approach.md`, explains how to approach a system
design interview (`practice/#/roadmap/approach`, readable without signing in,
and the static page `practice/approach/`). Guides are listed in
`frontend/src/practice/guide/guides.ts`; their ids are reserved. On the roadmap a problem opens only once every
problem before it is solved (with the same progress as the list, in the
browser or synced when signed in); the problem list itself stays open. A
problem opened from the roadmap (`practice/#/roadmap/<id>`) shows its stage
and, once solved, a link to the next one.

Anyone can see the stages, but starting the roadmap takes an account: signed
out, the page lists the problems without links and offers the sign-in buttons,
and `practice/#/roadmap/<id>` shows the roadmap instead of the problem (sign-in
returns to that address). The rule is `roadmapAccess` in `roadmap.ts`, the one
place to change when the roadmap moves behind a paid plan. A build without
accounts (`VITE_ACCOUNTS` unset, as in local development and the e2e build) has
nothing to sign in to, so the roadmap is open there.

The stages are plain data in `frontend/src/practice/roadmap.ts` (`ROADMAP`):
each has an `id`, a `title`, a sentence or two on what it teaches and why it
comes at that point (`why`), and its problem ids in the order they are solved.
To change the path, edit that list:

- Every problem must appear in the roadmap exactly once, so **a new problem
  needs a place in a stage**; `npm test` fails otherwise.
- An id that is not a problem fails the tests too, unless it is in `PENDING`
  in `roadmap.test.ts` (problems being added in parallel). The page skips ids
  that do not exist and stages left empty.
- Earlier stages are prerequisites of later ones: put a problem after the
  ideas it builds on, easier problems first within a stage.

## Adding a problem in 5 steps

1. **Scaffold** it: `proschi problem new seat-map` (inside the repository it
   goes to `frontend/src/practice/problems/`; elsewhere pass `--dir`). The
   template is a small complete problem that already passes the check.
2. **Write `problem.md`**: title, summary, difficulty, tags, hints and the
   statement; name every use case in bold and spell out the scenario names.
   Then write [`lesson.md`](#lessonmd) and [`interview.md`](#interviewmd)
   (and [`guided.md`](#guidedmd) if it joins the first roadmap stage).
3. **Write `given.proschi`**: the fixed nodes, the traffic, the requirements,
   any capacity the problem needs, and the tests that encode the key insight.
4. **Write the solution and the starter**, then calibrate (above) and replace
   the example wrong design with the shortcuts your limits must reject.
5. **Check** it: `proschi problem check` (or `npm test` in `frontend/`), then
   open `practice/#/seat-map` in `npm run dev` to read it as a solver would.
   The landing page and the practice list pick the folder up by themselves;
   add its id to a stage of [the roadmap](#the-interview-prep-roadmap).
