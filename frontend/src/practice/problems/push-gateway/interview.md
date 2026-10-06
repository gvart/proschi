## Questions

### How many devices are connected at once?
- kind: good
- fact: About 10 million devices connected to this cluster at once

About **10 million** devices.

### How long does a connection live?
- kind: good
- fact: A connection lives at most about 30 minutes before the client reconnects

At most about **30 minutes**, then the client reconnects (spread out randomly).

### How many messages a second are pushed?
- kind: good
- fact: 20k messages per second pushed at peak

**20k a second** at peak.

### How many recipients are connected when a message arrives?
- kind: good
- fact: 60% of them find their customer connected

**60%** find the device connected, 38% do not, 2% find a stale record.

### Do senders wait for the push servers?
- kind: good
- fact: Senders only hand a message over; they never wait for the registry or a push server

No: senders only hand a message over, and have no connection to the push servers.

### What latency do send and connect need?
- kind: good
- fact: p99 of Send under 30 ms, of Connect under 60 ms

p99 of **Send** under **30 ms**, of **Connect** under **60 ms**, of an online **Deliver** under **100 ms**.

### Can an accepted message be lost?
- kind: good
- fact: An accepted message is stored durably before the sender hears back

No: it is stored durably before the sender hears back.

### Do we build iOS or Android first?
- kind: weak

The client platform does not change the gateway.

### Can messages carry images?
- kind: weak

A payload detail; ask about rates and connections.

### Which TLS library do we use?
- kind: weak

An implementation detail.

## Estimates

### How many connects a second if 10 million connections each last about 30 minutes?
- answer: 5556
- unit: connects/s
- range: 4000 to 7000

10M ÷ 1,800 s ≈ **5,500 a second**.

### How many messages a second find the device offline and must wait?
- answer: 7600
- unit: messages/s
- range: 6000 to 9000

20k × 38% = **7,600 a second**.

### At 10 KB of server memory per connection, how much do 10 million connections take?
- answer: 100
- unit: GB
- range: 60 to 150

10M × 10 KB = **100 GB**, spread over the push servers.

Numbers: [Numbers to know](../docs/numbers/).
