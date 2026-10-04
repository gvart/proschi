import type { Problem } from '../types';

export const rateLimiter: Problem = {
  id: 'rate-limiter',
  title: 'Rate Limiter',
  difficulty: 'easy',
  tags: ['caching', 'edge', 'protection'],
  statement: `The Orders API is being hammered by a few noisy clients. Put a rate
limiter in front of it: each client may make at most **100 requests per
minute**; anything above that is rejected with \`429 Too Many Requests\`
before it reaches the Orders API.

## Functional requirements

- **Call API**: a client calls \`GET /orders\`. Model it with two scenarios:
  - \`"Allowed"\`: the client is under its limit; the request reaches the
    Orders API and the client gets \`200\`.
  - \`"Limited"\`: the client is over its limit and gets \`429\`; the Orders
    API never sees the request.

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- **5k rps** in total, of which about 5% is over the limit.
- Counters must be shared: the limiter runs on several machines and a client
  may hit any of them.

## Constraints

- p99 of a call under **200 ms**, including the limit check.
- Available **99.9%** of the time.
- Losing any single machine must not take the API down.
- At most **$3,000 / month** for everything, the Orders API included.

## What is given

\`problem.proschi\` declares the \`client\` and the \`orders\` service (five
replicas, already sized for the allowed traffic) and holds the traffic,
requirements and tests. Add the limiter, where its counters live, the
connections and the use case.`,
  given: `title "Rate Limiter" "Rejects clients over 100 requests per minute before they reach the Orders API"

client "Client"     [Actor]
orders "Orders API" [REST API] x5 @orders "The service being protected"

traffic {
  "Call API" 5k rps mix "Allowed" 95%, "Limited" 5%
}

requirements {
  p99 "Call API" < 200ms
  availability "Call API" >= 99.9%
  survive any node failure
  cost <= 3000 usd/month
}

test "Limits are checked before the Orders API" {
  "Call API" has scenario "Allowed"
  "Call API" has scenario "Limited"
  "Call API" calls any cache before orders
}

test "Rejected calls never reach the Orders API" {
  "Call API" scenario "Limited" never calls orders
  "Call API" scenario "Limited" responds 429
}
`,
  starter: `import "problem.proschi"

# Add the rate limiter, where its counters live, and the use case "Call API".

client -> orders

usecase "Call API" {
  client  -> orders : GET /orders
  orders --> client : 200
}
`,
  solution: `import "problem.proschi"

gateway  "API Gateway"  [AWS API Gateway] x2 @platform "Entry point; asks the limiter about every call"
limiter  "Rate Limiter" [REST API]        x5 @platform "Fixed-window counters per client"
counters "Counters"     [Redis]           x2 @platform "One counter per client and minute, expiring after 60 s"

client  -> gateway
gateway -> limiter  : check
limiter -> counters : INCR / EXPIRE
gateway -> orders   : HTTP

entity Counter in counters "Requests of one client in the current minute" {
  key    string key
  count  int
  expire time
}

decision "Shared counters in Redis" {
  because "Every limiter replica must see the same count, and INCR is atomic and takes ~1 ms"
  rejected "In-memory counters per replica" "A client spread over 5 replicas could make 5x its limit"
}
decision "Fixed one-minute windows" because "Simplest correct answer for 100 requests per minute; bursts at window edges are acceptable"

usecase "Call API" "A client calls the protected API" {
  client   -> gateway  : GET /orders
  gateway  -> limiter  : check client-42
  limiter  -> counters : INCR rate:client-42
  counters --> limiter : 37

  alt "Allowed" when "the client made at most 100 calls this minute" {
    limiter --> gateway : 200 allow
    gateway  -> orders  : GET /orders
    orders  --> gateway : 200 {"orders": []}
    gateway --> client  : 200 {"orders": []}
  } alt "Limited" when "the client is over its limit" {
    limiter --> gateway : 429
    gateway --> client  : 429 {"error": "rate_limited"}
  }
}
`,
  hints: [
    'The counters must be shared by every limiter replica. Which kind of store answers in about a millisecond?',
    'Write the limit check before the call to the Orders API, and leave the call out of the "Limited" scenario altogether.',
    'Every component needs a second replica to survive losing one machine; size the limiter for 5k rps at well under 70% busy.',
  ],
};
