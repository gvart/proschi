---
title: Prioritized Load Shedding
summary: "Netflix's Zuul gateway: rank every request and shed logs before playback when a spike hits."
difficulty: medium
company: Netflix
tags: [load-shedding, resilience, api-gateway, availability, real-world]
version: 2
strict: true
hints:
  - "The API service cannot grow during the spike, and it is asked for 125% of what it can serve. Some requests must not be served. Which ones would a member miss least?"
  - "Put a gateway (id zuul, an [API Gateway]) between the devices and the API service, and send every request through it. It is the first to see each request, so it is the place to rank them."
  - "\"Save progress\" and \"Send logs\" each get two scenarios. In \"Served\" Zuul forwards to the API service; in \"Shed\" Zuul itself answers 503 and never calls the API service. \"Start playback\" has no shed scenario at all."
  - "Zuul receives all 20k requests a second, the shed ones too. At 10k per instance, size it to stay well under 70% busy after losing one, and keep the budget in mind."
---

Netflix's edge gateway, **Zuul**, sits in front of every backend and sees
every request from phones, TVs and browsers. Not all of those requests
matter the same: a failed play request is an error on the screen, a lost
pause marker means the next episode starts a little off, and a dropped log
upload goes unnoticed.

When a retry storm, a bad deploy or an under-scaled service leaves a
backend with more traffic than it can serve, serving everything slowly
fails everyone. Zuul
instead gives each request a priority as it arrives and, while the backend
is strained, rejects the lowest-priority requests first, so playback keeps
working through the spike. Design that gateway.

## Functional requirements

- **Start playback**: a member presses play. This request is critical: it
  always reaches the API service, whatever the load.
- **Save progress**: the app saves a pause or stop marker. Losing it
  degrades the experience but does not stop playback. Two scenarios:
  - `"Served"`: Zuul forwards the request to the API service.
  - `"Shed"`: Zuul answers `503` itself, with a hint of when the device may
    retry, and the API service never sees the request.
- **Send logs**: the app uploads logs and other background data. It is
  non-critical. Same two scenarios, `"Served"` and `"Shed"`.

Name the gateway `zuul`, an `[API Gateway]`: the tests in `problem.proschi`
refer to it, to the API service `api` and to the use case and scenario
names above.

## Scale

The traffic is the peak of a spike. Netflix does not publish request rates
or how much of each class it sheds; every number here is an assumption for
the exercise.

- During the spike, devices send **6k play requests**, **4k progress
  markers** and **10k log uploads** per second: 20k requests a second.
- The API service runs **8 instances of 2k requests a second**: 16k a
  second, so the spike asks for 125% of what it can serve.
- At this level of strain, Zuul's priority threshold sheds **half of the
  progress markers** and **90% of the log uploads**, and no play requests.
  The traffic mix in `problem.proschi` already holds these shares.
- One Zuul instance handles **10k requests a second**.

## Constraints

- Every request goes through Zuul: no path from the devices to the API
  service.
- The API service is fixed at 8 instances: it cannot scale out within the
  minutes the spike lasts.
- A shed request is answered by Zuul with a 503 and never reaches the API
  service; a served one is answered by the API service.
- Playback is never shed.
- p99 of **Start playback** under **100 ms**, of the other two under
  **150 ms**.
- **Start playback** available **99.99%** of the time.
- Losing any single machine must not break a latency limit.
- At most **$1,600 / month**, the API service included.

## What is given

`problem.proschi` declares the `device` (the client: the Netflix app on any
device) and `api`, the API service with its 8 instances, which you cannot
change. It sets the traffic of the three use cases with the shares of
`"Served"` and `"Shed"`. Add Zuul, the connections and the three use cases.

## What this model leaves out

- **The shedding decision itself.** In Netflix's system the threshold
  moves with the backend's error rate and concurrency or Zuul's CPU, and
  sheds more of each class the worse it gets. The simulation does not
  react to load, so the problem fixes the shed shares for one moment of the
  spike in the traffic mix. The tests check where shedding happens and that
  playback is never shed; the design does not earn the percentages.
- **The priority score.** Zuul scores each request from 1 to 100 from its
  attributes; here each class is a use case of its own, so the priority is
  the use case.
- **What a rejection costs.** Rejecting a request is much cheaper for Zuul
  than proxying it, but the simulation charges both the same, so Zuul's
  load here is on the high side.
- **Retries.** The `503` carries how many retries a device may make and
  after how long. The simulation does not model devices retrying, so a
  retry storm, the overload's usual cause, is described, not simulated.
- **Zuul's own overload** (global throttling) and the per-device testing
  Netflix ran are in the lesson, not the tests.

## Based on

- Manuel Correa, Arthur Gonigberg and Daniel West, [Keeping Netflix Reliable Using Prioritized Load Shedding](https://netflixtechblog.com/keeping-netflix-reliable-using-prioritized-load-shedding-6cc827b02f94),
  Netflix TechBlog, November 2020: the three priority buckets
  (non-critical such as logs and background requests, degraded experience
  such as stop and pause markers, viewing history and player language
  selection, and critical, which affects the ability to play), a priority
  score from 1 to 100 computed at Zuul from each request's attributes,
  shedding below a threshold that rises progressively (along a cubic
  curve) as service throttling (a backend's error rate or concurrent
  requests) or global throttling (Zuul's CPU, concurrent requests or
  connections) kicks in, the `maxRetries` and `retryAfterSeconds` hint sent
  to devices, the failure-injection and 45-minute ChAP experiments, and a
  2020 incident where shedding kept streams per second steady where a
  similar 2019 one had stopped members from playing.
