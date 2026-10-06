## Questions

### How many pastes are created a second?
- kind: good
- fact: 50 pastes per second are created, at peak

**50 pastes a second** at peak.

### How many reads a second?
- kind: good
- fact: Reads: 5k rps

**5k reads a second**.

### Are reads concentrated on a few pastes?
- kind: good
- fact: 90% of them for pastes that were read in the last few minutes

Yes: **90%** are for pastes read in the last few minutes (a shared link gets opened by everyone at once); 1% are for expired pastes.

### How big is a paste?
- kind: good
- fact: A paste is 10 KB on average and up to 10 MB

**10 KB** on average, up to **10 MB**.

### How fast must a popular paste load?
- kind: good
- fact: loads in under 30 ms at p99

A popular paste loads in under **30 ms** at p99: only an edge close to the reader is that fast.

### What does sending data to readers cost?
- kind: good
- fact: $0.02/GB from a CDN and $0.09/GB from anything else you run

**$0.02/GB** from a CDN and **$0.09/GB** from anything else you run.

### Can a paste ever be lost?
- kind: good
- fact: A paste is never lost once its id has been returned

Never, once its id has been returned.

### Which languages should syntax highlighting support?
- kind: weak

A client-side feature that changes nothing on the server.

### Should pastes have comments?
- kind: weak

Scope creep; settle the core read and write paths first.

### Which web framework should the API use?
- kind: weak

The framework does not change the architecture.

## Estimates

### How much storage do five years of pastes take at 50 a second and 10 KB each?
- answer: 79T
- unit: bytes
- range: 50T to 120T

50 × 10 KB = 500 KB/s × 86,400 × 365 × 5 ≈ **79 TB**: object storage, not database rows.

### How much data a month do 5k reads a second of 10 KB send?
- answer: 130T
- unit: bytes
- range: 100T to 160T

5k × 10 KB = 50 MB/s × 2.6M s ≈ **130 TB a month**.

### What does that cost a month from a CDN at $0.02/GB?
- answer: 2600
- unit: USD/month
- range: 2000 to 3200

130,000 GB × $0.02 ≈ **$2,600 a month**; from the API at $0.09 it would be $11,700.

Numbers: [Numbers to know](../docs/numbers/).
