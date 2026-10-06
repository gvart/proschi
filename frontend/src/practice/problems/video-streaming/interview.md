## Questions

### How many uploads, and how big?
- kind: good
- fact: 2 uploads per second (about 170k videos a day), about 2 GB each

**2 uploads a second** (about 170k videos a day), about **2 GB** each.

### How many video pages are opened?
- kind: good
- fact: 5k rps of video page opens, 95% of them for popular videos

**5k a second**, **95%** for popular videos.

### How many segment requests, and how big?
- kind: good
- fact: 10k rps of segment requests, about 4 MB each; 99% are for segments already at the edge

**10k a second**, about **4 MB** each; **99%** already at the edge.

### Can the creator wait for transcoding?
- kind: good
- fact: Transcoding never runs while the creator waits

No: transcoding never runs while the creator waits, and it is fed by a queue.

### Do our servers handle the uploaded bytes?
- kind: good
- fact: No server of yours touches the video bytes on the way in

No: the creator uploads to storage directly.

### How fast must a segment arrive?
- kind: good
- fact: p99 under 600 ms, the transfer included

A 4-second segment: p99 under **600 ms**, the transfer included.

### Is there a budget?
- kind: good
- fact: At most $2.5M / month, bandwidth and the transcoding fleet included

At most **$2.5M a month**, bandwidth and the transcoding fleet included.

### What should the player skin look like?
- kind: weak

A UI detail.

### Do we support comments?
- kind: weak

A separate feature.

### Which codec is best?
- kind: weak

It matters later; the bandwidth and the pipeline come first.

## Estimates

### How much upload data arrives a day?
- answer: 346T
- unit: bytes
- range: 250T to 450T

2 × 2 GB × 86,400 ≈ **346 TB a day**.

### How much do 10k segments a second of 4 MB send in a month?
- answer: 104
- unit: PB
- range: 80 to 130

10k × 4 MB = 40 GB/s × 2.6M s ≈ **104 PB a month**.

### What does that cost a month from a CDN at $0.02/GB?
- answer: 2.1M
- unit: USD/month
- range: 1.6M to 2.6M

104M GB × $0.02 ≈ **$2.1M a month**; from storage at $0.09 it would be $9.4M.

Numbers: [Numbers to know](../docs/numbers/).
