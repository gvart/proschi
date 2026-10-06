## Questions

### How many greetings a second do we need to serve?
- kind: good
- fact: 200 requests a second to Say hello

About **200 requests a second** to Say hello. That is small: one API
replica takes about 2,000 a second, so load is not what shapes this design.

### How fast must a greeting come back?
- kind: good
- fact: p99 of Say hello under 100 ms

The p99 of Say hello must stay under **100 ms**: 99 requests out of 100
answered within that. One database read on the way is fine.

### How often may the service be down?
- kind: good
- fact: Say hello available 99.9% of the time

Say hello must be available **99.9%** of the time, about 43 minutes of
downtime a month. Both the API and the database are on every request, so
both must be better than that.

### Can one machine of something be enough?
- kind: good
- fact: Every component has a spare: two replicas or more

No: every component has a spare, **two replicas or more**. One copy of
anything is a single point of failure.

### What should the greeting say?
- kind: weak

The wording of the greeting does not change the design. Ask about how many
requests arrive, how fast they must be answered and how often the service
may be down.

### Which web framework should the API use?
- kind: weak

The framework barely changes the architecture. Ask about the numbers
(traffic, latency, availability) that decide which components you need and
how many of each.

### Should the greeting be in several languages?
- kind: weak

A nice feature, but the statement does not ask for it, and it would not
change the request path. Spend your questions on scale and constraints
first.

## Estimates

### One API replica takes about 2,000 requests a second. How busy is it at 200 a second, in percent?
- answer: 10
- unit: %
- range: 8 to 12

200 ÷ 2,000 = **10% busy**. Load is not the problem here; one replica
could carry the traffic ten times over.

### One API replica is up 99.5% of the time and one database replica 99.95%. What is the availability of Say hello with one of each, in percent?
- answer: 99.45
- unit: %
- range: 99.4 to 99.5

Both are on every request, so multiply: 99.5% × 99.95% ≈ **99.45%**, about
four hours down a month, against the 43 minutes 99.9% allows. Two replicas
of each fix it.

Numbers: [Numbers to know](../docs/numbers/).
