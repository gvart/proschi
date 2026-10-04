import type { Problem } from '../types';

export const urlShortener: Problem = {
  id: 'url-shortener',
  title: 'URL Shortener',
  difficulty: 'easy',
  tags: ['caching', 'read-heavy', 'durability'],
  statement: `Design a service that turns long URLs into short codes and sends
visitors who open a short link to the original URL.

## Functional requirements

- **Shorten**: a visitor posts a long URL and gets a short code back.
- **Redirect**: a visitor opens \`/<code>\` and is redirected (\`302\`) to the
  long URL. Name its two scenarios \`"Cache hit"\` and \`"Cache miss"\`.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- Redirects: **10k rps**, 95% of them for codes that were opened recently.
- Shortening: **100 rps**.

## Constraints

- p99 of a redirect under **100 ms**, of shortening under **200 ms**.
- Redirects available **99.9%** of the time.
- A short code is never lost once it was returned to the visitor.
- Losing any single machine must not take the service down.
- At most **$3,000 / month**.

## What is given

\`problem.proschi\` declares the \`visitor\` and holds the traffic,
requirements and tests. Your file imports it; add the components,
connections and the two use cases.`,
  given: `title "URL Shortener" "Turns long URLs into short codes and redirects visitors to them"

visitor "Visitor" [Actor]

traffic {
  "Redirect" 10k rps mix "Cache hit" 95%, "Cache miss" 5%
  "Shorten"  100 rps
}

requirements {
  p99 "Redirect" < 100ms
  p99 "Shorten" < 200ms
  availability "Redirect" >= 99.9%
  durable "Shorten"
  survive any node failure
  cost <= 3000 usd/month
}

test "Redirects read the cache first" {
  "Redirect" calls any cache before any database
  "Redirect" scenario "Cache hit" never calls any database
}

test "Codes are stored before they are returned" {
  "Shorten" writes any database before responding
  "Shorten" responds 201
}

test "Redirects redirect" {
  "Redirect" responds 302
}
`,
  starter: `import "problem.proschi"

# Add the components, connections and the use cases "Shorten" and "Redirect".
api "Shortener API" [REST API]

visitor -> api

usecase "Shorten" {
  visitor -> api : POST /links json {"target": "https://example.com/a/long/path"}
  api --> visitor : 201 {"code": "aZ3x9"}
}
`,
  solution: `import "problem.proschi"

lb    "Load Balancer" [AWS Load Balancer] x2
api   "Shortener API" [REST API]          x12 @links "Creates codes and serves redirects"
cache "Code Cache"    [Redis]             x2 @links "Recently opened codes and their targets"
db    "Links DB"      [DynamoDB]          x2 @links "Every code and its target"

visitor -> lb
lb      -> api   : HTTPS
api     -> cache : GET / SET
api     -> db    : read / write

entity Url in db "One short code and where it points" {
  code      string key
  target    string
  createdAt time   index
}

decision "Cache redirects in Redis" {
  because "Reads outnumber writes 100:1 and p99 must stay under 100 ms"
  rejected "Database reads only" "Every redirect pays a database round trip"
}
decision "Base62 codes from a counter" because "Short, unique, no collisions to retry"

usecase "Shorten" "Create a short code for a long URL" {
  visitor -> lb      : POST /links json {"target": "https://example.com/a/long/path"}
  lb      -> api     : POST /links
  api     -> db      : PutItem Url
  db     --> api     : ok
  api    --> lb      : 201 {"code": "aZ3x9"}
  lb     --> visitor : 201 {"code": "aZ3x9"}
}

usecase "Redirect" "Send a visitor to the target of a code" {
  visitor -> lb    : GET /aZ3x9
  lb      -> api   : GET /aZ3x9
  api     -> cache : GET code:aZ3x9

  alt "Cache hit" when "the code was opened recently" {
    cache --> api : target
  } alt "Cache miss" when "the code is not cached" {
    cache --> api   : nil
    api    -> db    : GetItem Url
    db    --> api   : target
    api   ->> cache : SET code:aZ3x9
  }
  api --> lb      : 302 Location
  lb  --> visitor : 302 Location
}
`,
  hints: [
    'Redirects outnumber shortening 100 to 1. What can answer a redirect without touching the database?',
    'p99 is decided by the slowest scenario that carries at least 1% of traffic: the cache miss path counts.',
    'One instance of anything is a single point of failure: use x2 or more on every component.',
    'A REST API handles about 2k rps per replica in the simulation; size the API so it stays well below 70% busy.',
  ],
};
