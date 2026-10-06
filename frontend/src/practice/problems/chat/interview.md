## Questions

### How many messages are sent a second at peak?
- kind: good
- fact: Send message: 10k rps

**10k messages a second** at peak, from 50M daily active users.

### How many recipients are online when a message arrives?
- kind: good
- fact: 70% of recipients are online at that moment

**70%** are online and connected to a gateway; the rest get a push notification.

### Are the sender and the recipient usually connected to the same server?
- kind: good
- fact: the sender and the recipient are almost never connected to the same one

Almost never: connections are spread over many gateway servers, so a message is routed between servers through a pub/sub broker.

### How fast must sending be, and what does the ack promise?
- kind: good
- fact: p99 of sending (until the ack) under 100 ms

p99 of sending, until the ack, under **100 ms**. The ack is a promise: a message is never lost once the sender saw it.

### Does the ack wait until the message is delivered?
- kind: good
- fact: The ack never waits for delivery

No. The ack never waits for the push provider or the recipient's connection: look up presence and deliver after the ack.

### How often is history loaded?
- kind: good
- fact: Load history: 2k rps

**2k history loads a second**, with a p99 under **200 ms**.

### Is there a budget?
- kind: good
- fact: At most $4,000 / month

At most **$4,000 a month**.

### Should we support stickers and GIFs?
- kind: weak

A feature that rides on the same send path. Settle the scale and the delivery guarantees first.

### Which websocket library should we use?
- kind: weak

A library choice does not change the architecture. Ask how many connections and messages there are.

### What should the message bubbles look like?
- kind: weak

A UI question; the interview is about how a message gets from one server to another.

## Estimates

### How many messages a second go to connected recipients?
- answer: 7000
- unit: messages/s
- range: 5k to 9k

10k × 70% = **7,000 a second** through the pub/sub broker; the other 3,000 become push notifications.

### If the average is a third of the peak and a stored message takes 1 KB, how much history is written a day?
- answer: 290
- unit: GB
- range: 150 to 600

10k ÷ 3 ≈ 3.3k a second × 86,400 s ≈ 288M messages × 1 KB ≈ **290 GB a day**, about 100 TB a year.

Numbers: [Numbers to know](../docs/numbers/).
