```tldr
A system design interview is a **conversation, not a quiz**. Follow **four steps**: scope, high-level design, deep dive, wrap-up, and get a **complete system on the board** before polishing any part. Back every choice with **rough numbers**: per-second load, latency orders of magnitude and availability nines.
```

There is rarely one right answer. The interviewer wants to see how you turn a
vague request ("design a URL shortener") into a concrete system, which
trade-offs you notice, and whether you can defend your choices with numbers.
This guide gives you a plan for the usual 45 to 60 minutes and the handful of
numbers you need along the way. Every problem on the roadmap is practice for
exactly this plan.

## The four steps

Most good interviews follow the same arc. Watch the clock: the times below
are for a 45-minute slot; stretch them in proportion for longer ones.

```numbers
5–8 min | **Scope** and requirements
10–15 min | **High-level** design
15–20 min | **Deep dive**
3–5 min | **Wrap-up**
```

| Step | Time | What you produce |
|---|---:|---|
| 1. Scope and requirements | 5–8 min | Use cases, scale, the numbers that matter, what is out of scope |
| 2. High-level design | 10–15 min | Boxes and arrows for every use case, end to end |
| 3. Deep dive | 15–20 min | One or two components examined closely: data model, scaling, failures |
| 4. Wrap-up | 3–5 min | Bottlenecks, trade-offs, what you would do next |

```callout pitfall Running out of time
The most common failure is not a wrong design. It is spending 30 minutes on
one component and never showing a complete system. **Get something end to end
on the board first**, then improve it.
```

### Step 1: scope and requirements

Start by asking questions, and write the answers down where both of you can
see them. You are looking for two lists.

**Functional requirements** are what the system does: the use cases. Name
them precisely ("a user posts a message", "a follower reads their feed") and
agree which are in scope. Three or four is plenty; saying "search and
moderation are out of scope for now" is a sign of judgement, not of weakness.

**Non-functional requirements** are how well it must do it:

- **Scale**: requests per second for each use case, the read-to-write ratio,
  the number of users, the size of the data.
- **Latency**: how fast each use case must answer, ideally as a percentile
  ("p99 under 200 ms": 99% of requests answer within 200 ms).
- **Availability**: how much downtime is acceptable (see the nines below).
- **Consistency and durability**: may a reader see slightly stale data? May
  any write ever be lost? Money and inventory usually answer "no"; likes and
  view counts usually answer "a little is fine".
- **Cost**: often unstated, always relevant. Ask whether there is a budget.

```callout interview No numbers given? Propose some
If the interviewer has no numbers, propose some and say they are
assumptions. **Numbers you chose are far better than no numbers at all.**
```

### Step 2: high-level design

Draw the system for every use case, end to end, before optimising anything:
the client, the entry point (a load balancer or API gateway), the services
and the data stores. Walk each use case through the diagram out loud: "the
client sends a POST to the API, the API inserts the row, then answers 201".

Keep services stateless where you can, so any replica can serve any request
and you scale by adding copies. Put state in stores chosen for their access
pattern:

| Store | Use it for |
|---|---|
| Key-value store | Lookups by key |
| Relational database | Transactions and flexible queries |
| Object storage | Large blobs |
| Queue | Work that can happen later |

At the end of this step you should be able to point at every requirement
and say which part of the diagram meets it, even if roughly.

### Step 3: deep dive

Now go deep on the parts that decide whether the design works. The
interviewer will often pick one; if not, choose the component under the most
pressure from your numbers. Typical deep dives:

- **The data model**: entities, keys, indexes, and how the data is
  partitioned once it no longer fits one machine.
- **The hot path**: what makes the most frequent use case fast. Usually a
  cache, a precomputed result or a CDN (a network of caches near users).
- **Failures**: what happens when each component dies, and what the user
  sees. Retries, timeouts, fallbacks, idempotency (a retried request has the
  same effect as a single one).
- **Contention**: what happens when many requests want the same row, seat or
  counter at once.

```callout interview Name the alternative you rejected
For every choice, say what else you considered and why you did not pick it.
"I chose a queue here rather than a synchronous call because the email
provider is slow and occasionally down, and the user does not need to wait
for the email" is the kind of sentence interviewers remember.
```

### Step 4: wrap-up

Finish by stepping back. Name the bottleneck you would hit first at ten
times the traffic, the trade-offs you accepted (staleness for speed, cost for
availability), and what you would add with more time: monitoring and
alerting, rate limiting, a second region. A calm, honest summary of the
design's limits is worth more than a last-minute feature.

## Back-of-the-envelope estimation

Estimation is not about precision. It is about knowing whether a number is a
thousand or a million, because that decides whether one machine is enough or
you need fifty.

```numbers
~100,000 | seconds in a day (86,400)
~2.5 million | seconds in a month
~30 million | seconds in a year
2–5× | peak over the average
```

A few habits make it quick:

- **Round hard.** A day has about 100,000 seconds (86,400), a month about
  2.5 million, a year about 30 million.
- **Go from daily to per second.** 10 million requests a day is about 100 per
  second on average. Peaks are often 2 to 5 times the average; say which one
  you are sizing for.
- **Multiply out storage.** Items per day × bytes per item × days you keep
  them. A billion items of 1 KB is a terabyte.
- **Divide by what one machine does.** If one server handles a few thousand
  simple requests per second, 50,000 rps needs tens of servers, not one and
  not a thousand.
- **Leave headroom.** Servers slow down sharply as they approach 100% busy,
  so plan to run them well below it, and keep enough spare to lose one.

The tables below are the essentials; [Numbers to know](https://proschi.app/docs/numbers/)
has the full cheat sheet (latency, throughput per server, sizes, cloud
prices) and a fully worked estimate.

```deepdive Powers of two and ten that come up all the time
| Unit | Roughly |
|---|---|
| 1 KB | a short JSON document or database row |
| 1 MB | a photo, a long article with images |
| 1 GB | fits comfortably in one machine's memory |
| 1 TB | fits on one machine's disk; a big but ordinary database |
| 1 PB | needs a distributed storage system |
```

```quiz
qps-from-daily-users
servers-for-peak-load
```

### Latency numbers worth knowing

You do not need exact figures, but you should know the order of magnitude of
the common operations. They explain why caches exist and why cross-region
calls hurt.

| Operation | Order of magnitude |
|---|---:|
| Read from main memory | ~100 ns |
| Read 1 MB sequentially from memory | ~10 µs |
| Round trip inside a data centre | ~0.5 ms |
| Read from an in-memory cache over the network | ~1 ms |
| Simple indexed database query | a few ms |
| Read 1 MB from an SSD | ~1 ms |
| Round trip between continents | ~100–150 ms |

```callout takeaway Keep the hot path in memory and in one region
Memory is thousands of times faster than a network round trip, and a round
trip inside one data centre is hundreds of times faster than one across an
ocean. Designs that keep the hot path in memory and in one region are fast;
designs that cross regions on every request are not.
```

```quiz
round-trip-latencies
```

### Availability in nines

Availability is the share of time a system works. Each extra nine divides the
allowed downtime by ten.

| Availability | Downtime per year | Downtime per month |
|---|---:|---:|
| 99% ("two nines") | ~3.65 days | ~7.3 hours |
| 99.9% | ~8.8 hours | ~44 minutes |
| 99.95% | ~4.4 hours | ~22 minutes |
| 99.99% | ~53 minutes | ~4.4 minutes |
| 99.999% | ~5 minutes | ~26 seconds |

Two rules let you reason about availability on a whiteboard:

- **Components in a chain multiply.** A request that needs three components,
  each up 99.9% of the time, succeeds about 99.7% of the time. Every extra hop
  on the critical path costs availability.
- **Replicas in parallel multiply the downtime.** Two independent replicas
  that are each down 1% of the time are both down only 0.01% of the time:
  99% becomes 99.99%. That is why "two of everything" is the first answer to
  an availability requirement.

```quiz
three-nines-downtime
availability-in-series
```

## How Proschi maps to the interview

Every practice problem is the interview, written down. The statement is the
interviewer's prompt after step 1: the use cases, the scale and the
constraints are already agreed. Your design is steps 2 and 3. The tests are
the follow-up questions an interviewer would ask.

- **Use cases are your step 2 walkthrough.** Each `usecase` block is the
  request flow you would narrate at the whiteboard, and the diagram is drawn
  from it.
- **`traffic` is your back-of-the-envelope.** The simulation spreads each use
  case's rate over the components it calls, so you see the same division you
  would do by hand: how busy each component is, and which one gives out first.
- **Latency is computed, not guessed.** Each component has a base latency, it
  slows down as it gets busy, and a use case's percentile mixes its scenarios
  by their share. That is why a few percent of slow cache misses can decide
  p99, exactly the argument you would make in an interview.
- **Availability follows the two rules above.** Replicas of a node multiply
  its downtime; the nodes on a request's path multiply their availability.
  `survive any node failure` removes one instance of every component and
  checks the design still holds.
- **Cost is a requirement.** Every replica has a monthly price, so the
  simulation rejects the "just add more servers" answer the same way an
  interviewer would ask "and what does that cost?".
- **Tests encode the key insight.** "Redirects read the cache first",
  "codes are stored before they are returned": these are the sentences you
  should be able to say out loud about your design.

```deepdive How accurate are the simulation's numbers?
The numbers are deliberately simple teaching values, right to an order of
magnitude. They are meant to tell a sound design from a broken one, not to
replace a load test; [How the simulation works](https://proschi.app/docs/model/)
lists every formula and default.
```

Each step of the roadmap starts with a lesson that explains the concepts
behind its problem, then the challenge, then the review of your design.

```callout tip How to use the roadmap
Read the lesson, try the problem without the hints, and only then compare
with the reference solution. The struggle is where the learning happens.
```

## Further reading

- [The System Design Primer](https://github.com/donnemartin/system-design-primer)
  on GitHub: a free, broad overview of the building blocks, with an interview
  approach and many worked examples.
- Alex Xu, *System Design Interview – An Insider's Guide*, especially the
  chapters "A Framework For System Design Interviews" and
  "Back-of-the-envelope Estimation".
- Martin Kleppmann, *Designing Data-Intensive Applications*: the book to read
  for depth on replication, partitioning and consistency.
- [Latency numbers every programmer should know](https://gist.github.com/jboner/2841832),
  the classic table, with the caveat that hardware has moved on since it was
  written; the orders of magnitude still hold.
- [Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)
  in Google's *Site Reliability Engineering* book: how availability targets
  are chosen and measured in practice.
