## Questions

### How many calls a second does the app make, and to which endpoints?
- kind: good
- fact: 30k fare estimates, 4k trip requests and 6k profile reads a second

**30k fare estimates**, **4k trip requests** and **6k profile reads** a second: **40k calls a second** through the edge (assumptions for the exercise).

### What can the auth service take?
- kind: good
- fact: The auth service runs 3 instances of about 2k calls a second each

It runs **3 instances** of about **2k calls a second** each, so about 6k in all, and it belongs to another team: you cannot add instances.

### How often does a call carry a session we have seen recently?
- kind: good
- fact: 95% of calls carry a token whose session is in the cache

About **95%** of calls carry a token whose session is already in the cache. About 2% of fare estimates come from a blocked rider.

### Where must authentication and bans be checked?
- kind: good
- fact: Authentication and bans are checked in the gateway, before the call is routed

In the gateway, before the call is routed. Backend services do not call the auth service, and a blocked rider's call never reaches a backend.

### What latency and availability do we need?
- kind: good
- fact: p99 of every use case under 100 ms

p99 of every endpoint under **100 ms**, each available **99.95%** of the time.

### What failures must the design survive?
- kind: good
- fact: Losing any single machine must not break a latency limit

Losing any single machine must not break a latency limit, and every call passes the edge, so that includes a gateway instance.

### Is there a budget?
- kind: good
- fact: At most $2,800 / month, the backend services included

At most **$2,800 a month**, the four backend services included.

### Should the gateway be written in Go or Java?
- kind: weak

Uber moved from Node.js to Go and Java, but the language does not change the design. Ask what each gateway instance and the auth service can take.

### Which fields does a fare estimate return?
- kind: weak

A product detail that belongs to the pricing service, not the edge. Ask how many calls a second reach the gateway and the auth service.

### Should we use Kong or Envoy?
- kind: weak

A product choice, not the design. Ask what the edge must do for every call (authenticate, block, route) and what the services behind it can take.

## Estimates

### With 95% of sessions in the cache, how many calls a second reach the auth service?
- answer: 2000
- unit: calls/s
- range: 1500 to 2500

40k × 5% = **2,000 calls a second**, a third of the auth service's 6k. Without the cache it would get all 40k, almost seven times its capacity.

### At about 10k calls a second per gateway instance, how many instances keep the pool under 70% busy after losing one?
- answer: 7
- unit: instances
- range: 7 to 9

40k ÷ (10k × 70%) ≈ 5.7, so **6 must remain** after a failure: **7 instances**. Five would run at 80% and hit 100% after losing one.

Numbers: [Numbers to know](../docs/numbers/).
