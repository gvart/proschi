# Writing practice problems

The practice page (`frontend/practice/`, code in `frontend/src/practice/`)
serves system design problems. Each problem is one TypeScript file in
`frontend/src/practice/problems/`, listed in `problems/index.ts`. The format
comes from [the design](design/hld-and-practice.md#53-practice-platform-practice).

```ts
export interface Problem {
  id: string;                         // url-shortener: the URL is practice/#/url-shortener
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];                     // caching, queues, consistency, …
  statement: string;                  // Markdown
  given: string;                      // Proschi: traffic, requirements, tests, fixed nodes (e.g. client)
  starter: string;                    // starts with: import "problem.proschi"
  solution: string;                   // reference solution; must pass every test
  hints: string[];
}
```

## The parts

**`given`** is the problem as Proschi, read-only for the solver. The editor
resolves `import "problem.proschi"` to it, so it is merged into whatever the
solver writes:

- `title "Name" "Summary"`
- the fixed nodes the solver connects to: the client, and any existing system
  the problem is about (`orders "Orders API" [REST API] x5`)
- `traffic { … }` with the rate of every use case and the scenario mix
- `requirements { … }`: latency, availability, durability, failure and cost
- `test "…" { … }` blocks that encode the key insight of the problem, e.g.
  *the cache is read before the database*, *rejected calls never reach the
  backend*

No `import` inside `given`.

**`statement`** says what to build, in Markdown: a short context, then
`## Functional requirements` (name every use case in bold, e.g.
`**Redirect**`, and the scenario names the tests refer to), `## Scale`,
`## Constraints` and `## What is given`. The renderer understands headings,
paragraphs, bullet and numbered lists (one level of nesting), fenced code,
`inline code`, **bold**, *italics* and links; HTML is shown as text.

**`starter`** begins with `import "problem.proschi"` and gives a small,
valid start: usually one use case with its first step. It must have no errors
of its own.

**`solution`** is a complete design that passes every requirement and test,
written like a good answer: replicas sized for the traffic, `entity` blocks,
`decision` blocks that explain the trade-offs, and `when` conditions on the
scenarios.

**`hints`** go from a nudge to nearly the answer; the page reveals them one
at a time.

## Checks

`frontend/src/practice/practice.test.ts` checks every problem: unique URL-safe
ids, the starter and solution import `problem.proschi`, every use case in the
traffic is defined by the solution and named in bold in the statement, the
starter has no errors, the solution parses without errors, and the solution
passes every test in the simulation. Run `npm test` in `frontend/`.

## Use case and scenario names

Traffic, requirements and tests refer to use cases and scenarios by name, so
the statement must spell out the exact names (`"Cache hit"`, `"Cache miss"`)
and the solver must use them. The test messages name what is missing when they
do not match.
