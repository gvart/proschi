---
title: API Gateway
summary: "Uber's Edge Gateway: a stateless pool that authenticates and routes every app call, with sessions cached."
difficulty: medium
company: Uber
tags: [api-gateway, caching, authentication, availability, real-world]
version: 2
strict: true
hints:
  - "Every call from the app needs the same things done first: is the token valid, is this rider blocked, which service handles this path? Where can that happen once, for every service, instead of in each of them?"
  - "Put a load balancer and a pool of gateway instances in front of the services. There is no connection from the app to any service: the app knows one address."
  - "The auth service takes about 6k calls a second; the app makes 40k. Keep recently validated sessions in a cache the gateway reads first (\"Session cached\" never calls auth); only \"Session not cached\" asks the auth service, then writes the session to the cache. The same cache holds the short-term bans, so \"Blocked\" answers 403 without routing the call."
  - "The gateway carries every call: 40k a second at about 10k per instance. Size the pool to stay under about 70% busy with one instance gone, which means seven, and keep the load balancer and the cache at two each."
---

Uber's apps make every call through one edge tier, the **Edge Gateway**.
Hundreds of backend services, owned by many teams, sit behind it, and none
of them is reached by an app directly. The gateway does the work every call
needs, the same way for every endpoint: it decodes the request, runs
**middleware** (authentication, bans, rate limits), routes the call to the
service that owns the path, and encodes the answer.

Each endpoint is configuration, not hand-written code: a team declares the
path, the target service and the middleware it needs, and Uber generates
the gateway from that configuration. Every endpoint must use at least one
authentication middleware, and when a middleware rejects a call, the rest
of the stack is skipped and the middleware's answer goes back.

The catch is that everything depends on the edge. If authentication there
calls the auth service for every request, the auth service carries the
whole app's load; if the gateway pool cannot lose an instance, a single
crash takes every endpoint down at once.

## Functional requirements

Three endpoints, each routed to a different service:

- **Get fare estimate**: the rider app asks for a price; the gateway routes
  the call to `pricing`. Three scenarios:
  - `"Session cached"`: the token was validated recently and its session
    is in the cache; the auth service is not asked.
  - `"Session not cached"`: no cached session, so the gateway asks `auth`
    to validate the token, caches the result, then routes the call.
  - `"Blocked"`: the cache holds a short-term ban for this rider; the
    gateway answers **403** and the call reaches no backend.
- **Request trip**: the rider confirms a ride; routed to `trips`. Scenarios
  `"Session cached"` and `"Session not cached"`, as above.
- **Get rider profile**: the app loads the rider's profile; routed to
  `users`. Scenarios `"Session cached"` and `"Session not cached"`.

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- **30k fare estimates**, **4k trip requests** and **6k profile reads** a
  second: **40k calls a second** through the edge. Uber does not publish the
  gateway's current rates for one region; these are assumptions for the
  exercise (its previous generation served 800k requests a second at peak).
- **95%** of calls carry a token whose session is in the cache. About
  **2%** of fare estimates come from a blocked rider. Both shares are
  assumptions.
- The auth service runs **3 instances** of about **2k calls a second**
  each.

## Constraints

- No connection from the app to any backend service: every call goes
  through a load balancer and the gateway pool.
- Authentication and bans are checked in the gateway, before the call is
  routed; backend services do not call the auth service.
- A blocked rider's call never reaches a backend.
- p99 of every use case under **100 ms**.
- Every use case available **99.95%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$2,800 / month**, the backend services included.

## What is given

`problem.proschi` declares the `rider` app and four services owned by other
teams: `auth`, `pricing`, `trips` and `users`, with their instances and
capacity fixed by the problem. Add the edge (a load balancer, the gateway
pool and the cache of sessions and bans), the connections and the three use
cases. The tests find the edge by its kind: `[AWS Load Balancer]` or any
load balancer, `[API Gateway]` or any gateway, `[Redis]` or any cache.

## What this model leaves out

- The session cache is this exercise's assumption. Uber's post says every
  endpoint runs authentication middleware and that the gateway keeps
  central caches with a TTL (short-term bans fed by fraud and security
  systems, data-center affinity), but not how a token check itself is
  served.
- A cached session stays valid until its TTL runs out, even if the token is
  revoked meanwhile. TTLs are not simulated; the lesson covers the
  trade-off.
- Rate limiting, circuit breakers per backend, timeouts, load shedding and
  protocol conversion are all part of Uber's gateway, but only the ban
  check is drawn as a scenario. A slow backend dragging the whole gateway
  down is described, not simulated.
- The share of calls with a cached session is the scenario mix, not
  something the cache earns: warm-up and eviction are not modelled.

## Based on

- Madan Thangavelu, Abhishek Parwal and Rohit Patali,
  [The Architecture of Uber's API gateway](https://www.uber.com/blog/architecture-api-gateway/),
  Uber Engineering blog, May 2021: one entry point for all apps in front of
  the back-end services; routing, protocol conversion, rate limiting, load
  shedding and user access blocking at the edge; a request stack of
  protocol manager, middleware, endpoint handler and client, where a
  failing middleware short-circuits the call; authentication middleware
  required on every endpoint; endpoints declared as configuration and
  generated into Go code; a circuit breaker around each back-end client;
  and a central cache of short-term bans with a TTL.
- Pavel Astakhov, Madan Thangavelu and Uday Kiran Medisetty,
  [Designing Edge Gateway, Uber's API Lifecycle Management Platform](https://www.uber.com/blog/gatewayuberapi/),
  Uber Engineering blog, August 2020: the previous generation served 800k
  requests a second at peak in front of 400+ services owned by 100+
  teams; a few APIs' performance regressions slowed the whole gateway and
  business logic leaked into it, and the third generation moved that logic
  out of the edge.
