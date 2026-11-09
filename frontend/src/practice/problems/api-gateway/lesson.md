# API gateway: one edge for every call

```tldr
Put **one stateless gateway pool behind a load balancer** in front of every service, and do the work each call needs there once: authenticate, check bans, route. Serve the token check from a **cache of recently validated sessions**, so the auth service sees only the misses. And size the pool so **losing an instance hurts nobody**: everything in the app goes through it.
```

## What you'll learn

- What an API gateway is for, and what should stay out of it.
- Why the gateway, not each backend, should run authentication and bans, and why a rejected call should stop there.
- How a cache of validated sessions turns the auth service from the busiest service in the company into a quiet one, and what that cache costs you in revocation time.
- Why a component that every request crosses needs more headroom than any other, and how to size it.

## The problem, explained

Uber's rider and driver apps talk to hundreds of backend services, owned by many teams. Letting the app call each of them directly would mean every service has to authenticate users, block abusers, limit rates and speak the app's protocols, and every app release would have to know where every service lives. Instead Uber puts one tier at the edge, the **Edge Gateway**: the apps know a single address, and the gateway forwards each call to the service that owns its path.

The gateway runs the same steps for every call. A protocol layer decodes the request (JSON, Thrift or Protobuf), then a stack of **middleware** runs: authentication, authorization, rate limits, bans. If a middleware rejects the call, the stack stops there and its answer goes back. Otherwise the endpoint handler maps the request to a backend call, and a generated client sends it with timeouts, retries and a circuit breaker. Endpoints are configuration that a team publishes, from which Uber generates the gateway's Go code.

The exercise keeps three endpoints:

- **Get fare estimate** to `pricing`, with three scenarios: `"Session cached"`, `"Session not cached"` and `"Blocked"` (a short-term ban answers 403 at the edge).
- **Request trip** to `trips`, and **Get rider profile** to `users`, each with `"Session cached"` and `"Session not cached"`.

The given has the `rider` app and four services owned by other teams: `auth`, `pricing`, `trips` and `users`. You add the load balancer, the gateway pool and a cache that holds sessions and bans. The limits: p99 under 100 ms for every endpoint, 99.95% availability, no latency limit broken by losing any one machine, and at most $2,800 a month. The tests check:

- Every call starts at the app, passes a load balancer and then a gateway before it reaches a service, and the app has no path to any service.
- Every endpoint reads the cache before it calls `auth`, and a cached session never calls `auth`.
- The session is checked before the call is routed, and no backend calls `auth` itself.
- A blocked rider's call never reaches `pricing` and is answered 403.

## Back-of-the-envelope

```numbers
40k / s | calls through the edge
6k / s | what the auth service can take
2k / s | reach auth with a 95% session hit rate
7 | gateway instances: under 70% busy with one gone
$1,100 | for the whole edge, of the $2,800 budget
```

All the traffic numbers are assumptions for the exercise; Uber publishes its architecture, not one region's rates. They are scaled down, but the ratios are what matter.

| Flow | Rate | Reaches |
|---|---|---|
| Fare estimates | 30k / s | `pricing` (29.4k after the 2% blocked) |
| Trip requests | 4k / s | `trips` |
| Profile reads | 6k / s | `users` |
| Every call | 40k / s | load balancer, gateway, cache |
| Session not cached (5%) | 2k / s | `auth` |

**The auth service.** Three instances at about 2k calls a second each make 6k. If the gateway asked it about every call, it would get 40k: almost seven times what it can serve. With 95% of sessions in the cache, it gets 5% of 40k, which is 2k a second, a third of its capacity, and still only half after losing one instance.

**The gateway.** One instance serves about 10k calls a second in the simulation. Four would run at 100%. Five run at 80% and pass on a normal day, but losing one puts the other four at 100%. To stay under about 70% busy with one instance gone, you need 40k ÷ 7k ≈ 6 instances left, so **7** in the pool (57% busy normally, 67% after a failure).

**The cache.** 40k reads and 2k writes a second, on Redis instances that take 100k each: two of them, for redundancy more than for load.

**Cost.** The four services are fixed at $1,500. Two load balancers ($100), seven gateway instances ($700) and two cache nodes ($300) add $1,100, so $2,600 in all. The budget leaves room for two more gateway instances, not for a pool sized by guesswork.

```quiz
hit-rate-to-db-load
servers-for-peak-load
```

## Concepts

### What an API gateway does

An API gateway is a reverse proxy that understands your API. It takes every call from the outside, and does the work that is the same for every endpoint:

| Concern | Without a gateway | With one |
|---|---|---|
| Authentication | Every service validates tokens | Once, in middleware |
| Bans and rate limits | Every service, or nobody | Once, before routing |
| Routing | The app knows every service's address | The app knows one address |
| Protocols | Every service speaks the app's protocol | The gateway converts |
| Logs and auditing | Scattered | One access log for every call |

What stays out: business logic. Uber's previous gateway let product code creep in, and a few APIs' performance problems slowed the whole gateway, while the gateway team became the bottleneck for every product change. The third generation keeps the edge to cross-cutting work and moves product logic behind it.

```callout takeaway The gateway does what every call needs, and nothing a single product needs
Authentication, bans, limits, routing and protocol conversion belong at the edge. Pricing rules do not.
```

```quiz
api-gateway-scope
reverse-proxy-roles
```

### Middleware that short-circuits

Middleware are small steps that run in order before the endpoint's handler: authenticate, authorize, check bans, apply a rate limit. Each either lets the call continue or answers it. When one answers, the rest of the stack is skipped, including the backend call.

That is why a ban check belongs at the edge. A blocked rider's call that reaches `pricing` before anyone notices still costs a backend call, and depends on every service remembering to check. At the edge, it costs one cache read and a 403.

Uber keeps its short-term bans (users, app versions, other identifiers) in a central cache with a TTL, fed by its fraud and security systems. The gateway reads it on the way in.

```quiz
authn-vs-authz
load-shedding
```

### Serving auth checks from a cache

Every endpoint needs to know who is calling. If the token is opaque, someone must look it up; if it is signed, someone must check the signature and whether it was revoked. Doing that by asking the auth service makes the auth service carry the whole app's traffic: it becomes the busiest service you have, and a hiccup there fails every endpoint.

A **session cache** fixes that. When the gateway sees a token, it reads the cache first. On a hit, it has the user id and carries on. On a miss, it asks the auth service, writes the answer to the cache with a short TTL, and carries on. This is plain cache-aside, applied to identity.

The cost is revocation time. A session in the cache stays valid until its entry expires, so a token revoked at the auth service keeps working for up to one TTL. Three ways to live with it:

- Keep the TTL short (minutes, not hours).
- Delete the entry on logout or password change.
- Keep a separate ban list the gateway checks on every call, which is what Uber's short-term bans do.

Uber's post does not say how its authentication middleware serves token checks; the session cache is this exercise's assumption, built on the same pattern as the ban cache the post describes.

```callout pitfall The cache does not decide who you are
The auth service is still the source of truth. The cache only remembers its recent answers, for a bounded time.
```

````deepdive Cache-aside on another example
The same shape protects any expensive lookup. Here a feature-flag service sits behind a cache:

```proschi fragment
usecase "Load flags" {
  app -> flagsCache : GET flags:{user}
  alt "Hit" {
    flagsCache --> app : flags
  } alt "Miss" {
    app -> flags      : Evaluate(user)
    app -> flagsCache : SET flags:{user} EX 60
  }
}
```

Only the misses reach the flag service, so its load is the miss rate times the traffic.
````

```quiz
api-gateway-session-cache
jwt-revocation
```

### The gateway must not become the bottleneck

A service that only some calls reach can fail and take only its feature with it. The gateway is different: every call crosses it, so if it slows down, everything slows down, and if it fails, the app is down. Three habits keep it from becoming the single point of failure:

- **Stateless instances behind a load balancer.** Any instance can serve any call, so the pool grows by adding instances and loses one without losing anything but capacity. Sessions and bans live in the shared cache, not in an instance's memory.
- **Headroom for a failure.** Size the pool so that with one instance gone it still runs under about 70%. Past that, queueing makes latency climb fast, and at 100% it collapses.
- **Isolation from slow backends.** A circuit breaker around each backend client (Uber wraps every one) stops a slow service from tying up the gateway's capacity for everyone else. The simulation does not model that cascade, but an interviewer will ask.

```quiz
correlated-failures
circuit-breaker
```

## Designing it step by step

**1. Clarify.** Which apps, which endpoints, how many calls a second? Who owns authentication, and what can the auth service take? Are there bans or rate limits to enforce, and must a rejected call stop at the edge? What latency and availability does the whole app need, given that everything passes the edge?

**2. High level.** Draw the app, one load balancer, a gateway pool and the services behind it. There is no line from the app to any service. Each endpoint is a route from the gateway to one service.

**3. Middleware.** Put the checks in order: read the session and the ban list from the cache in one round trip; on a ban, answer 403; on a miss, ask the auth service, then cache the session. Only then route the call. Write each endpoint's scenarios so the cached case never touches `auth`.

**4. Size it.** Count the calls on each tier: the load balancer, the gateway and the cache see every call; the auth service sees only the misses; each backend sees its own endpoint's calls. Size the gateway pool for a failure, not for the average, and keep two of the load balancer and the cache.

**5. Check the budget and the tail.** Add up the edge's cost against what is left after the services, then look at p99: a cached call is load balancer, gateway, cache and backend; a miss adds an auth call and a cache write.

**6. Wrap up.** Mention what else the edge gives you once it exists: one access log for auditing, rate limits per user or IP, protocol conversion, client SDKs generated from the same configuration, and a circuit breaker per backend.

## Common mistakes

**Asking the auth service about every call** (`wrong/auth-on-every-call`). Correct, and simple: the gateway validates every token with the auth service. That puts 40k calls a second on a service built for 6k; it saturates, and every endpoint's p99 goes with it. Caught by **"Sessions are checked from a cache"** and the latency limits.

**Apps calling each service directly** (`wrong/apps-call-services-directly`). No edge at all: each service validates tokens itself. Every service carries its own copy of the auth logic, the auth service still gets every call, and the app depends on every service's address. Caught by **"Every call enters through the edge"** and **"The session is checked before the call is routed"**.

**A gateway pool with no headroom** (`wrong/gateway-no-headroom`). Five instances handle 40k calls at 80% and pass on a normal day. Losing one puts the remaining four at 100%, and every endpoint in the app fails together. Caught by **survive any node failure**.

**Backends checking the ban list** (`wrong/backend-checks-bans`). The gateway authenticates but leaves bans to each service, so a blocked rider's call is routed to `pricing` before anyone says no. Caught by **"Blocked riders never reach a backend"**.

Classic mistakes beyond the tests:

- Putting business logic in the gateway, so every product change needs the gateway team and one slow endpoint slows them all.
- Keeping sessions in each gateway instance's memory, so the hit rate drops as the pool grows and a restart empties it.
- A session TTL of hours, so a revoked token keeps working long after logout.
- Retrying a failing backend from the gateway without a circuit breaker, which multiplies the load on the service that is already struggling.

## In the interview

```callout interview Lead with "everything goes through it"
Say early that the gateway sits on every request's path. That one fact explains the rest: why it must stay thin, why auth checks must not cost a remote call each, and why it needs more headroom than anything else.
```

Likely follow-ups:

- *A user logs out. How soon does the token stop working?* Within one TTL of the cached session, unless logout deletes the entry. Bans take effect on the next call, because the ban list is read every time.
- *The cache is down. What now?* Fall back to the auth service for a short time and shed load if it cannot keep up, or fail closed for sensitive endpoints. Two cache nodes make this rare, and the choice is per endpoint.
- *How do you rate limit across a pool of gateways?* Counters in a shared store, or a local limit per instance set to the global limit divided by the pool size; Uber can change quotas without redeploying.
- *Why not JWTs and no auth calls at all?* Signed tokens remove the lookup but cannot be revoked before they expire, so you still need a ban or revocation list: the same cache, checked every call.
- *How do teams add endpoints without the gateway team?* Uber's teams publish configuration (path, schema, target service, middleware) through a UI backed by Git, and the gateway is generated from it.

## Further reading

- Madan Thangavelu, Abhishek Parwal and Rohit Patali, [The Architecture of Uber's API gateway](https://www.uber.com/blog/architecture-api-gateway/) (Uber, 2021): the request stack, middleware, configuration and code generation, and the central caches.
- Pavel Astakhov, Madan Thangavelu and Uday Kiran Medisetty, [Designing Edge Gateway, Uber's API Lifecycle Management Platform](https://www.uber.com/blog/gatewayuberapi/) (Uber, 2020): three generations of Uber's gateway and why business logic left the edge.
- Netflix Technology Blog, [Zuul 2: The Netflix Journey to Asynchronous, Non-Blocking Systems](https://netflixtechblog.com/zuul-2-the-netflix-journey-to-asynchronous-non-blocking-systems-45947377fb5c) (Netflix, 2016): another company's edge gateway, and why it moved to a non-blocking design.
- [Zanzibar](https://github.com/uber/zanzibar): Uber's open-source code generator behind the Edge Gateway.
- [System Design Primer: Reverse proxy](https://github.com/donnemartin/system-design-primer#reverse-proxy-web-server) and [Load balancer](https://github.com/donnemartin/system-design-primer#load-balancer): the building blocks a gateway sits on.
- Chris Richardson, [Pattern: API Gateway / Backends for Frontends](https://microservices.io/patterns/apigateway.html): the pattern, its variants and its drawbacks.
- Alex Xu, *System Design Interview – An Insider's Guide, Volume 1*, chapter "Design a Rate Limiter": where limits go, including in an API gateway.
