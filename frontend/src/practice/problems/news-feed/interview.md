## Questions

### How many feed reads a second?
- kind: good
- fact: Read feed: 10k rps

**10k feed reads a second** at peak, from 20M daily active users.

### How many posts a second?
- kind: good
- fact: Publish post: 500 rps

**500 posts a second** at peak.

### How many followers does a user have, and are there celebrities?
- kind: good
- fact: A user has 200 followers on average, and nobody has more than 5,000

**200 followers** on average and **nobody above 5,000**: accounts with millions of followers are a follow-up.

### How much of a feed must we keep?
- kind: good
- fact: A feed only needs its newest 500 post ids

Only the newest **500 post ids**.

### Does publishing wait until every feed is updated?
- kind: good
- fact: Publishing never waits for the social graph or for the feeds

No: the author gets `201` as soon as the post is stored.

### Can reading a feed query the database?
- kind: good
- fact: Reading a feed never touches a database or the social graph

No: reading a feed never touches a database or the social graph.

### What latency do reads and posts need?
- kind: good
- fact: p99 of reading the feed under 50 ms, of publishing under 90 ms

p99 of a feed read under **50 ms**, of publishing under **90 ms**.

### What should the like button look like?
- kind: weak

A UI question; ask about the read and write rates.

### Which framework is the mobile app built with?
- kind: weak

The client does not change the server-side design.

### Can posts contain Markdown?
- kind: weak

Formatting is a detail of the post body; it does not change the fan-out.

## Estimates

### How many feed writes a second does fan-out cause?
- answer: 100k
- unit: writes/s
- range: 80k to 120k

500 posts × 200 followers = **100,000 feed writes a second**.

### How much memory do 20 million feeds of 500 post ids take at 8 bytes an id?
- answer: 80
- unit: GB
- range: 50 to 120

20M × 500 × 8 bytes = **80 GB**: a few cache nodes.

Numbers: [Numbers to know](../docs/numbers/).
