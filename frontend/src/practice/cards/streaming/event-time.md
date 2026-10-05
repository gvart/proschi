---
type: flip
difficulty: medium
tags: [realtime]
---

## Front

Why do analytics windows usually use **event time** rather than processing
time?

## Back

Events arrive late: phones go offline, pipelines back up, jobs replay old
data. With processing time, a click from 12:00 that arrives at 12:07 is
counted in the wrong minute, and a replay gives different answers. Event time
assigns it by when it happened.
