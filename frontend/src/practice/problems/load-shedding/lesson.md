# Prioritized load shedding: keep playback up when the backend can't keep up

```tldr
When a backend gets more traffic than it can serve, serving everything slowly fails everyone. Give every request a **priority at the gateway**, and while the backend is strained **reject the least important requests first, at the gateway**, with a hint of when to retry. Playback never gets shed; logs go first. Size the gateway for the whole spike, because it still receives every request it rejects.
```

## What you'll learn

- What **load shedding** is, and why rejecting some requests on purpose keeps a system more useful than accepting all of them.
- How to rank traffic into **priority buckets** by what a user would miss, as Netflix does for playback, progress markers and logs.
- Why the gateway, not the overloaded backend, is the place to shed.
- Why the shedder needs capacity for the whole spike, rejected requests included.
- Why "buy enough capacity for the worst spike" is usually the expensive answer, and how shedding interacts with retries.

## The problem, explained

Netflix's devices (phones, TVs, browsers) talk to Netflix through **Zuul**, its API gateway. Behind Zuul, backends answer very different kinds of requests. Some decide whether a member can watch at all: pressing play. Some make the experience a little worse if they fail: the marker that remembers where you paused. Some nobody notices: log uploads and background requests, which are also among the most numerous.

Overloads happen: a retry storm, a service that was scaled too small, a bad deploy. When a backend gets more requests than it can serve, its queues grow, every request slows down, many time out, and clients retry, which adds more load. Everything fails together, playback included.

Netflix's answer, described in its 2020 post, is **prioritized, progressive load shedding** at Zuul. Every request gets a priority score as it enters. When a backend (or Zuul itself) is under strain, Zuul raises a threshold and rejects the requests below it, so the lowest priorities go first, and more of them as the strain grows.

In this problem, a spike asks the API service for 20k requests a second while its 8 fixed instances serve 16k. Three use cases:

- **Start playback**: critical, 6k a second, never shed.
- **Save progress**: degraded experience, 4k a second; at this strain half are `"Shed"`, half `"Served"`.
- **Send logs**: non-critical, 10k a second; 90% `"Shed"`, 10% `"Served"`.

The traffic mix already holds those shares: the simulation cannot decide them for you. Your job is the shape: everything through Zuul, shed requests answered by Zuul with a 503 that never touches the API service, playback with no shed path, and enough Zuul for the full spike, within $1,600 a month.

## Back-of-the-envelope

```numbers
20k / s | asked of an API service that serves **16k**
125% | its load with nothing shed
9k / s | reach it once Zuul sheds: **56%**
50% | Zuul's load at 4 instances, 67% after losing one
$1,200 | a month for the reference design
```

**Without shedding.** 6k + 4k + 10k = 20k requests a second, against 8 × 2k = 16k: 125%. A saturated service misses every latency limit, the critical one included.

**With shedding.** Playback 6k, half the progress markers 2k, a tenth of the logs 1k: 9k a second, 56% of 16k. Losing one instance leaves 14k: 64%, still comfortable. Shedding 10k of the 20k requests barely changes what members see: the logs and half the pause markers.

**Zuul.** Every request arrives at Zuul, shed or not: 20k a second. At 10k per instance, two are at 100%; four run at 50%, and 67% after losing one.

**Cost.** 4 Zuul instances at $100 and the API service's 8 at $100: $1,200 a month, under the $1,600 budget. Serving every progress marker and log at the peak instead would need a second pool for 14k a second: 10 more instances at 70%, $1,000 more, for a spike that lasts minutes.

| Class | At the peak | Shed | Reaches the API |
|---|---|---|---|
| Start playback (critical) | 6k / s | 0% | 6k / s |
| Save progress (degraded) | 4k / s | 50% | 2k / s |
| Send logs (non-critical) | 10k / s | 90% | 1k / s |
| Total | 20k / s | | 9k / s |

```quiz
load-shedding
servers-for-peak-load
```

## Concepts

### Load shedding

**Load shedding** is rejecting some requests, early and cheaply, so the rest are served at normal speed. A service at 150% of its capacity that accepts everything serves nobody well: queues grow, latency climbs past every client's timeout, and the work done for requests that time out is wasted. A service that rejects a third of its requests at once serves the other two thirds as if nothing were wrong.

What it costs: the rejected requests fail. That is only acceptable if the client can live with it, which is why *which* requests to reject matters more than how many.

```callout takeaway Reject early, reject cheaply
A fast 503 for some requests beats a slow timeout for all of them.
```

### Priority buckets

Netflix ranks requests into three buckets by what a member loses when they fail:

| Bucket | Examples from Netflix's post | When it fails |
|---|---|---|
| **Non-critical** | Logs, background requests | Nobody notices |
| **Degraded experience** | Stop and pause markers, viewing history, player language selection | The experience is worse; playback still works |
| **Critical** | Requests that affect the ability to play | The member sees an error when pressing play |

Zuul turns each request into a **priority score from 1 to 100**, computed from the request's attributes as soon as it arrives, so every later stage can use it. Normally the score changes nothing. Under strain, a threshold rises and everything below it is rejected, like a priority queue that drops from the bottom.

One limit for all traffic (a single concurrency cap, a random drop) is the tempting shortcut. It drops a play request as readily as a log upload, so members see errors while logs still get through.

```callout pitfall Not all traffic is equal
Without priorities, shedding protects the servers but not the product.
```

```quiz
graceful-degradation
```

### Shed at the edge, not in the backend

Where the rejection happens decides whether it helps. A backend that checks priority and answers 503 has already accepted the connection, read the request and parsed it; under overload, that work *is* the overload. In this problem, an API service that sheds for itself still receives all 20k requests a second: 125% of its capacity, saturated, every class slow.

The gateway sees every request first. It can score it, compare the score with the threshold and answer 503 without forwarding anything. The backend only receives what it will serve.

Netflix applies this in two places:

- **Service throttling**: per backend. When a backend's error rate or concurrent requests cross a threshold, Zuul sheds the lowest-priority requests *to that backend*.
- **Global throttling**: for Zuul itself. When Zuul's CPU, concurrent requests or connection count cross a threshold, it sheds across all backends, because if Zuul goes down, nothing gets through.

```quiz
load-shedding-at-the-gateway
```

### Progressive shedding

Shedding is not on or off. The further past its limits a backend is, the higher the threshold goes. Netflix uses a cubic curve: with mild overload only the very lowest scores go, and the threshold climbs steeply as overload approaches its maximum. At the moment this problem models, all but a tenth of the logs and half of the progress markers are shed, and no play request.

````deepdive The curve in Netflix's post
The post's chart reads roughly like this: about 35% overload still keeps the threshold in the mid-90s, about 80% brings it to 50, and about 95% to 10. Each step up gives up a slice of less important traffic before touching the next. A cubic keeps the gateway gentle at low overload and decisive near the top.
````

### The shedder must not fall over

Rejecting is cheaper than serving, but not free: Zuul still accepts the connection, reads the request and answers. Size the gateway for **everything that arrives**, not for what it forwards. In this problem two Zuul instances would sit at 100% on the 20k requests a second; a saturated gateway slows every class at once, the critical one first among them. Four instances run at 50%, and 67% after losing one.

This is also why Netflix has global throttling: protecting the backends is pointless if the gateway in front of them is the next thing to collapse.

### Why not just add capacity?

An obvious alternative is to buy enough capacity for the worst spike: a bigger API service, or a separate pool for low-priority traffic (a **bulkhead**). Both are useful tools, and bulkheads in particular stop one class from starving another. But:

- **Spikes come faster than capacity.** Autoscaling takes minutes; a retry storm takes seconds.
- **You pay all month for minutes of need.** Here, a pool that serves every progress marker and log at the peak costs $1,000 a month more, nearly doubling the bill, for traffic nobody would miss for a few minutes.
- **Spikes have no ceiling.** Whatever you provision, a bigger spike can come. Shedding works at any size.

The usual answer combines them: provision for normal peaks with headroom, isolate where it is cheap, and shed by priority for the rest.

```quiz
bulkheads
```

### Retries: shedding without a storm

A rejected client retries. If every device retries at once, the shed traffic comes straight back, often several times over. Netflix's Zuul answers a shed request with a hint, how many retries the device may make and over what time window, and gives higher-priority requests more retries than lower ones. In the reference design a shed log upload gets no retries for two minutes and a shed progress marker one retry after 30 seconds (illustrative values; the post names the fields, not the numbers).

```quiz
retry-amplification
backoff-with-jitter
```

## Designing it step by step

**1. Scope.** Ask what the traffic classes are and what each costs the user when it fails. Confirm that the backend cannot grow during the spike and that playback must never fail. Ask how much each class is shed at this strain (given here).

**2. High level.** Devices → Zuul → API service, no other path. Three use cases, one per class.

**3. Deep dive.**

*Priority.* Zuul scores each request when it arrives. Draw it as a label on the first step: critical, degraded, non-critical.

*Shed at Zuul.* For progress markers and logs, two scenarios: `"Served"`, where Zuul forwards to the API service, and `"Shed"`, where Zuul itself answers 503 with a retry hint and the API service is never called. Playback has a single path that always reaches the API service.

*Check the numbers.* The API service now gets 9k of its 16k a second. Size Zuul for all 20k, with room to lose an instance.

*Retries.* Explain the retry hint and why lower priorities get fewer retries.

**4. Wrap up.** Mention how you would know it works: Netflix watches streams per second (SPS) and tests shedding with injected failures on a small share of real traffic.

```deepdive How Netflix tested it
Netflix used its failure-injection tool to shed chosen priority ranges for chosen devices or members, and ran 45-minute experiments on its chaos platform with a small treatment group whose low-priority requests were throttled, comparing playback per device type. The first run found a race condition on Android and iOS, where a low-priority request failing caused sporadic playback errors. Fixed, the experiments became a regular check. In a 2020 incident similar to one that stopped members from playing in 2019, shedding kept streams per second steady.
```

## Common mistakes

**Shedding inside the backend** (`wrong/shed-at-the-backend`). Zuul forwards everything, and the API service answers 503 to low-priority requests. It still receives all 20k a second, 125% of what it serves, so it saturates and every class is slow. Caught by **"Shed requests never reach the API service"** and the p99 limits.

**Shedding without priority** (`wrong/shed-without-priority`). One concurrency limit at Zuul for every request, so a play request can be shed like a log upload. Caught by **"Playback is never shed"**.

**Buying capacity for the spike** (`wrong/provision-for-the-spike`). A second pool sized to serve every progress marker and log at the peak. Playback is safe, but the bill goes to $2,200 a month for minutes of need. Caught by the **budget** and **"Shed requests never reach the API service"**.

**A gateway sized for what it forwards** (`wrong/undersized-gateway`). The right shedding on two Zuul instances: 20k requests a second fill them to 100%, and losing one makes it worse. Caught by **playback's p99** and **survive any node failure**.

Classic mistakes beyond the tests:

- Queueing excess requests instead of rejecting them: they wait past the client's timeout and the work is wasted.
- Rejecting with no retry guidance, so devices retry immediately and the spike doubles.
- Ranking by endpoint alone, so a prefetch and a user's own click on the same endpoint get the same priority.
- Never testing shedding in production, so the first real overload is also the first test.

## In the interview

```callout interview Lead with what the user loses
"Under overload, something fails. I choose what: logs first, then progress markers, never playback." Then say where (the gateway, before any backend work) and how much (progressive, by threshold), and only then the numbers.
```

Likely follow-ups:

- *How do you assign priority?* At the gateway, from the request's attributes (for example the endpoint, the device type, whether a user triggered it), computed once when it arrives so every later stage can use it.
- *What triggers shedding?* Per backend: its error rate or concurrent requests. For the gateway itself: CPU, concurrent requests, connections.
- *Won't shed clients just retry?* Answer with a retry hint, fewer retries for lower priorities, and clients that back off with jitter.
- *Why not autoscale?* It takes minutes, a spike takes seconds, and paying for the worst spike all month is expensive. Shed now, scale later.
- *How do you know it works?* Inject shedding on a small share of real traffic and watch the playback metric per device.

## Further reading

- Manuel Correa, Arthur Gonigberg and Daniel West, [Keeping Netflix Reliable Using Prioritized Load Shedding](https://netflixtechblog.com/keeping-netflix-reliable-using-prioritized-load-shedding-6cc827b02f94) (Netflix TechBlog, 2020) — the priority buckets, progressive shedding at Zuul and how it was tested.
- [Zuul](https://github.com/Netflix/zuul) — Netflix's open-source gateway.
- David Yanacek, [Using load shedding to avoid overload](https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/) (Amazon Builders' Library) — why overloaded servers waste work and how to reject cheaply.
- [Google SRE book: Handling Overload](https://sre.google/sre-book/handling-overload/) — client-side throttling, criticality levels and retry budgets.
- [Google SRE book: Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/) — how overload spreads, and load shedding as a defence.
- Michael T. Nygard, *Release It!*, chapter "Stability Patterns" — bulkheads, circuit breakers and shedding load.
