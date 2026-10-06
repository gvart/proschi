## Questions

### How many redirects and how many new links a second at peak?
- kind: good
- fact: Redirects: 10k rps

About **10k redirects a second** and **100 shortens a second**: reads
outnumber writes 100 to 1, so the read path is the design.

### Are most redirects for a small set of popular links?
- kind: good
- fact: 95% of them for codes that were opened recently

Yes: **95%** of redirects are for codes that were opened recently. A small
hot set answers almost every request, which is what a cache is for.

### How fast must a redirect be?
- kind: good
- fact: p99 of a redirect under 50 ms

The p99 of a redirect must stay under **50 ms**; shortening may take up to
**200 ms**. A database round trip on every redirect makes 50 ms hard.

### Can we ever lose a link after the user got the short code?
- kind: good
- fact: A short code is never lost once it has been returned to the visitor

Never. Once a code was returned it must already be written to a database,
not only to a cache.

### What availability do we need, and what failures must we survive?
- kind: good
- fact: Losing any single machine must not take the service down

Redirects must be available **99.9%** of the time, and losing any single
machine must not take the service down: no component with one instance.

### Is there a budget?
- kind: good
- fact: At most $3,000 / month

At most **$3,000 a month** for the whole service.

### Which programming language should the API be written in?
- kind: weak

The language barely changes the architecture. Ask about the numbers
(traffic, latency, durability) that decide which components you need.

### Should the short codes be six or seven characters long?
- kind: weak

A detail you can settle yourself in a sentence (62⁷ is 3.5 trillion codes).
Early in the interview, spend your questions on load and constraints.

### Can I use Kubernetes?
- kind: weak

Deployment tooling is not what the interviewer is assessing here. Ask what
the system must do and at what scale, then pick components that meet it.

## Estimates

### How many short codes are created in a year at 100 a second?
- answer: 3.2B
- unit: codes
- range: 1.5B to 6B

100/s × 86,400 s/day ≈ 8.6M a day; × 365 ≈ **3.2 billion a year**. Seven
base-62 characters (3.5 trillion codes) last for centuries.

Numbers: [Numbers to know](../docs/numbers/).

### At about 500 bytes per link, how much storage does a year of links take?
- answer: 1.6T
- unit: bytes
- range: 800B to 3.2T

3.2 billion links × 500 bytes ≈ **1.6 TB a year**: small enough for one
replicated database; storage is not the problem here, read latency is.

### If the cache answers 95% of redirects, how many reach the database each second?
- answer: 500
- unit: reads/s
- range: 400 to 650

10,000 × 5% = **500 reads a second**, plus 100 writes: a load any managed
database takes easily once the cache absorbs the rest.
