## Questions

### How many uploads and views a second?
- kind: good
- fact: 1k uploads a second, each followed by one pre-warm job

**1k uploads** a second, each followed by one pre-warm job. Views are far more frequent: **50k thumbnail views** and **2k preview opens** a second (assumptions for the exercise).

### How much of the viewing does the CDN absorb?
- kind: good
- fact: 50k thumbnail views a second, 95% of them answered at the edge

**95%** of thumbnail views are answered at the edge. Of preview opens, 80% are at the edge, 18% come from stored pre-warmed pages and 2% are generated on view.

### How expensive is each transformation?
- kind: good
- fact: A thumbnail worker renders 100 thumbnails a second in about 50 ms each; a preview worker renders 40 previews a second in about 500 ms each

A thumbnail worker renders **100 a second** (about 50 ms each); a preview worker **40 a second** (about 500 ms each).

### Do we pre-generate a preview for every file?
- kind: good
- fact: about 40% of pre-warms make the thumbnail only

No: about **40%** of pre-warms make only the thumbnail, for files unlikely to be previewed.

### Can the upload wait until the thumbnail is ready?
- kind: good
- fact: An upload never waits for a transformation: p99 under 200 ms

No. An upload never waits for a transformation: p99 under **200 ms**, and the file is stored durably before it answers.

### What latency do views need?
- kind: good
- fact: A thumbnail view never runs a worker: p99 under 100 ms

A thumbnail view never runs a worker: p99 under **100 ms**, available 99.99%. Opening a preview may take up to **1.5 s** at p99, on-view generation included.

### Is there a budget?
- kind: good
- fact: At most $12,500 / month, both worker pools included

At most **$12,500 a month**, both worker pools included.

### Which image library should render the thumbnails?
- kind: weak

The library is an implementation detail. Ask what a render costs (time per output) and how many are needed a second: those size the pool.

### Should we use Kubernetes for the workers?
- kind: weak

Deployment tooling is not what is assessed. Ask how much work each pool must do, and whether the user may wait for it.

### What thumbnail sizes do we need?
- kind: weak

A product detail that changes the number of outputs, not the architecture. Ask how often outputs are viewed compared with how often they are made.

## Estimates

### How many preview workers are fully busy with 600 pre-warmed previews and 40 generated on view each second?
- answer: 16
- unit: workers
- range: 14 to 20

(600 + 40) ÷ 40 previews per worker = **16 workers** at 100%. With headroom for a burst and a lost worker, about 24.

### If thumbnails were rendered again on every edge miss, how many extra renders a second would views add?
- answer: 2500
- unit: renders/s
- range: 2000 to 3000

50,000 views × 5% edge misses = **2,500 renders a second**, more than twice the 1,000 a second that uploads create. Storing each output once keeps that at zero.

### How many thumbnail workers are fully busy with 1k uploads a second?
- answer: 10
- unit: workers
- range: 8 to 12

1,000 thumbnails ÷ 100 per worker = **10 workers** at 100%. About 15 keep the pool near 70%, even with one lost.
