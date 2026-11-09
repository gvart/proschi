## Questions

### How much traffic of each kind arrives during the spike?
- kind: good
- fact: 6k play requests, 4k progress markers and 10k log uploads per second

**6k play requests**, **4k progress markers** and **10k log uploads** a second: 20k in all (assumptions for the exercise).

### How much can the backend serve?
- kind: good
- fact: 8 instances of 2k requests a second

The API service runs **8 instances of 2k requests a second**: 16k, so the spike asks for 125%.

### Can the backend scale out to absorb the spike?
- kind: good
- fact: it cannot scale out within the minutes the spike lasts

No: it is fixed at 8 instances and cannot scale out within the minutes the spike lasts.

### How much of each class gets shed at this level of strain?
- kind: good
- fact: sheds half of the progress markers and 90% of the log uploads, and no play requests

Zuul's threshold sheds **half of the progress markers** and **90% of the log uploads**, and no play requests.

### Can a play request ever be rejected?
- kind: good
- fact: Playback is never shed

No. Playback is never shed.

### What can one gateway instance handle?
- kind: good
- fact: One Zuul instance handles 10k requests a second

One Zuul instance handles **10k requests a second**.

### What are the latency limits and the budget?
- kind: good
- fact: At most $1,600 / month, the API service included

p99 of playback under **100 ms**, the others under **150 ms**, and at most **$1,600 a month**, the API service included.

### Which language is Zuul written in?
- kind: weak

It does not change the design. Ask what one instance can take, and what each class of request is worth to the member.

### Should we run it on Kubernetes?
- kind: weak

Deployment tooling is not what is assessed. Ask whether the backend can grow during the spike.

### What does the playback manifest contain?
- kind: weak

A detail of the playback service, not of the overload. Ask which requests matter most when not all can be served.

## Estimates

### With nothing shed, how loaded is the API service at the peak?
- answer: 125
- unit: %
- range: 110 to 140

20k requests a second ÷ (8 × 2k) = **125%**: saturated, and every class is slow.

### Once Zuul sheds, how many requests a second reach the API service?
- answer: 9000
- unit: requests/s
- range: 8000 to 10000

6k play + 50% of 4k progress + 10% of 10k logs = 6k + 2k + 1k = **9k a second**, 56% of 16k.

### How many Zuul instances keep it under 70% busy after losing one?
- answer: 4
- unit: instances
- range: 4 to 5

Zuul receives all **20k** a second, shed requests included. 20k ÷ 70% of 10k ≈ 2.9, so 3 must survive: **4 instances** (50% busy, 67% after losing one).

Numbers: [Numbers to know](../docs/numbers/).
