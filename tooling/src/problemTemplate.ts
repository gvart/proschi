/**
 * The files `proschi problem new <id>` writes: a small, complete problem that
 * already passes `proschi problem check`, with TODOs where the author's
 * problem goes. Keep it valid: test/problem.test.ts checks it.
 */
export function problemTemplate(id: string): Record<string, string> {
  const title = id
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return {
    'problem.md': `---
title: ${title}
summary: TODO One line for the problem list and the landing page.
difficulty: easy
tags: [caching, todo]
hints:
  - TODO A nudge, e.g. what answers most reads without the database?
  - TODO Closer, e.g. a miss reads the database, then fills the cache.
  - TODO Nearly the answer, e.g. two of everything survives any node failure.
---

TODO A short context: what the system does and for whom.

## Functional requirements

- **Fetch item**: a user asks for an item by id and gets it back. Name its
  two scenarios \`"Cache hit"\` and \`"Cache miss"\`.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- Fetch item: **1k rps**, 90% of them for items read recently.

## Constraints

- p99 of fetching an item under **100 ms**.
- Available **99.9%** of the time.
- Losing any single machine must not take the service down.
- At most **$2,000 / month**.

## What is given

\`problem.proschi\` declares the \`user\` and holds the traffic,
requirements and tests. Your file imports it; add the components,
connections and the use case.
`,
    'given.proschi': `# TODO The problem as Proschi: the fixed nodes the solver connects to, the
# traffic, the requirements and the tests that encode the key insight.
title "${title}" "TODO One line"

user "User" [Actor]

traffic {
  "Fetch item" 1k rps mix "Cache hit" 90%, "Cache miss" 10%
}

requirements {
  p99 "Fetch item" < 100ms
  availability "Fetch item" >= 99.9%
  survive any node failure
  cost <= 2000 usd/month
}

test "Items are read from the cache first" {
  "Fetch item" calls any cache before any database
  "Fetch item" scenario "Cache hit" never calls any database
}
`,
    'starter.proschi': `import "problem.proschi"

# TODO A small, valid start: usually one use case with its first step.
api "Item API" [REST API]

user -> api

usecase "Fetch item" {
  user -> api  : GET /items/42
  api --> user : 200 item
}
`,
    'solution.proschi': `import "problem.proschi"

lb    "Load Balancer" [AWS Load Balancer] x2
api   "Item API"      [REST API]          x2
cache "Item Cache"    [Redis]             x2
db    "Items DB"      [PostgreSQL]        x2

user -> lb
lb   -> api   : HTTPS
api  -> cache : GET / SET
api  -> db    : SELECT

decision "Cache items in Redis" because "Most reads are for recent items; the cache answers them in a millisecond"

usecase "Fetch item" "Return one item" {
  user -> lb    : GET /items/42
  lb   -> api   : GET /items/42
  api  -> cache : GET item:42

  alt "Cache hit" when "the item was read recently" {
    cache --> api : item
  } alt "Cache miss" when "the item is not cached" {
    cache --> api   : nil
    api    -> db    : SELECT item 42
    db    --> api   : item
    api   ->> cache : SET item:42
  }
  api --> lb   : 200 item
  lb  --> user : 200 item
}
`,
    'wrong/database-only.proschi': `# expect-fail: Items are read from the cache first
# TODO A plausible wrong design (here: no cache) and the tests it must fail.
import "problem.proschi"

lb  "Load Balancer" [AWS Load Balancer] x2
api "Item API"      [REST API]          x2
db  "Items DB"      [PostgreSQL]        x2

user -> lb
lb   -> api : HTTPS
api  -> db  : SELECT

usecase "Fetch item" {
  user -> lb  : GET /items/42
  lb   -> api : GET /items/42
  api  -> db  : SELECT item 42
  db  --> api  : item
  api --> lb   : 200 item
  lb  --> user : 200 item
}
`,
  };
}
