# Writing practice problems

The practice page (`frontend/practice/`, code in `frontend/src/practice/`)
serves system design problems. Each problem is a folder of plain files in
`frontend/src/practice/problems/`; there is nothing to register. The practice
page, the landing page's list and `proschi problem check` all read the same
folders. The idea behind the format is in
[the design](design/hld-and-practice.md#53-practice-platform-practice).

## Folder layout

```text
frontend/src/practice/problems/<id>/
  problem.md            front matter + the statement (Markdown)
  given.proschi         the problem as Proschi, read-only for the solver
  starter.proschi       starts with: import "problem.proschi"
  solution.proschi      the reference solution; starts with the same import
  wrong/<name>.proschi  optional: plausible wrong designs that must fail
```

The folder name is the problem id and its URL (`practice/#/url-shortener`):
lowercase letters and digits, words joined by `-`. Other files are an error,
so a typo like `solutoin.proschi` is caught. Wrong design names follow the same
rule (`wrong/miss-never-fills-cache.proschi`).

## `problem.md`

```markdown
---
title: URL Shortener
summary: Cache-first redirects with a fallback when Redis is down.
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
| `order` | no | A number: the position within its difficulty |
| `hints` | yes | A list, from a nudge to nearly the answer; the page reveals them one at a time |

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
`## Constraints` and `## What is given`. The renderer understands headings,
paragraphs, bullet and numbered lists (one level of nesting), fenced code,
`inline code`, **bold**, *italics* and links; HTML is shown as text.

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
✓ url-shortener: 10 tests, the starter fails 8, 1 wrong design
    wrong/miss-never-fills-cache: fails "Misses fill the cache"
…
12 problems, 36 wrong designs: no violations
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

## Adding a problem in 5 steps

1. **Scaffold** it: `proschi problem new seat-map` (inside the repository it
   goes to `frontend/src/practice/problems/`; elsewhere pass `--dir`). The
   template is a small complete problem that already passes the check.
2. **Write `problem.md`**: title, summary, difficulty, tags, hints and the
   statement; name every use case in bold and spell out the scenario names.
3. **Write `given.proschi`**: the fixed nodes, the traffic, the requirements,
   any capacity the problem needs, and the tests that encode the key insight.
4. **Write the solution and the starter**, then calibrate (above) and replace
   the example wrong design with the shortcuts your limits must reject.
5. **Check** it: `proschi problem check` (or `npm test` in `frontend/`), then
   open `practice/#/seat-map` in `npm run dev` to read it as a solver would.
   The landing page and the practice list pick the folder up by themselves.
