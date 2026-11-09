## Questions

### How often is configuration read, and how often does it change?
- kind: good
- fact: 1M requests per second at the edge, each reading 3 settings

**1M requests a second** at the edge, each reading **3 settings**, against **1k changes a second** at peak (both assumptions sized from Cloudflare's published totals).

### How many places need a copy?
- kind: good
- fact: 200 data centers, each with its own copy of the configuration

**200 data centers**, each with its own copy. A change travels as a log entry of about **2 KB**.

### Can a request fetch configuration from the core when it needs it?
- kind: good
- fact: An edge request reads only its server's local store: never the root or the main nodes

No: an edge request reads only its server's local store, never the root or the main nodes. A data center must keep serving when cut off from the core.

### Does the customer have to wait until the change is live everywhere?
- kind: good
- fact: the customer's answer does not wait for any copy below it

No. A change is written once, to the root, and the answer does not wait for any copy below it.

### What do the core nodes give us?
- kind: good
- fact: each node serves about 20k operations a second, carries 100 MB/s of traffic and costs $500 / month

Each `[Key-Value Store]` node serves about **20k operations a second**, carries **100 MB/s** and costs **$500 a month**.

### What latency, availability and budget?
- kind: good
- fact: p99 of Serve request under 20 ms

p99 under **20 ms** for requests and **100 ms** for changes, **99.99%** availability, surviving the loss of any machine including the root, and at most **$5,000 a month**.

### Which LMDB version do you run?
- kind: weak

The version does not change where reads come from or how changes spread; ask how often configuration is read and written instead.

### What does the dashboard look like?
- kind: weak

A UI question; ask how many changes a second the dashboard and API produce.

### Should configuration be stored as JSON or protobuf?
- kind: weak

The encoding matters less than its size; ask how large a change is on the wire.

## Estimates

### Each change is about 2 KB, 1k changes arrive a second, and every change must reach 200 data centers. How many bytes a second reach the edge?
- answer: 400
- unit: MB/s
- range: 300 to 500

1k × 200 × 2 KB = **400 MB/s**. From two root nodes that carry 100 MB/s each, that would be 200%: the reason for a tier of main nodes.

### The main tier moves about 412 MB/s, and a node carries 100 MB/s. How many main nodes keep it under 100% with one of them down?
- answer: 6
- unit: main nodes
- range: 6 to 7

Five would leave four carrying 412 MB/s against 400: saturated. **Six** run at 69%, and 82% with one down.

### How many configuration reads a second does the edge make in all?
- answer: 3M
- unit: reads/s
- range: 2.5M to 3.5M

1M requests × 3 settings = **3M reads a second**, 15k per data center: easy for a local store, 150 central nodes' worth if they went to the core.

Numbers: [Numbers to know](../docs/numbers/).
