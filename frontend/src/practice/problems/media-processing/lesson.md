# File Previews and Thumbnails: generate once, in the background, and serve many times

```tldr
A thumbnail or a document preview costs real CPU to make and almost nothing to serve again. So the upload only **stores the original and enqueues a job**; a coordinator dispatches the work to **one worker pool per transformation**, stores each output **once**, and every later view is answered by a **CDN** in front of that store. Workers only run on the read path in the rare case nothing was made in advance.
```

Dropbox shows a thumbnail for every file and a browser preview for most documents. The system that makes them, Riviera, grew from a preview service into a platform that runs hundreds of thousands of transformations a second. This lesson builds its core idea: keep the expensive work off both the upload path and the view path.

## What you'll learn

- Why a slow transformation belongs behind a queue, and what the upload must still do before it answers.
- What *pre-warming* is: generating derived outputs before anyone asks, and what it costs.
- Why a derived output is generated once and stored, and why the read path never runs a worker on a CDN miss.
- How to size a worker pool from a rate and a per-worker throughput, and why each transformation gets its own pool.
- Where a CDN goes in front of a store of immutable outputs.

## The problem, explained

**Who uses it.** Every Dropbox user: the file list needs a thumbnail per file, and opening a document in the browser needs its pages rendered as images. Behind them, other teams use the same outputs; Dropbox's post mentions that one 160×160 thumbnail serves both previews and machine-learning pipelines, so it is made once for both.

**What makes it hard.** Transformations are slow and varied. A thumbnail is quick, but a PowerPoint preview means converting the deck to PDF and rendering each page as an image. If any of that runs while a user waits, the user feels it; if it runs every time someone looks, the worker fleet grows with views instead of with uploads.

**Functional requirements.**

- **Upload file**: store the original, answer `201`.
- **Pre-warm**: from a queue, generate a new file's thumbnail, and its preview if the file is likely to be opened, and store them. Scenarios `"Thumbnail and preview"` and `"Thumbnail only"`.
- **View thumbnail**: `"Edge hit"` or `"Edge miss"` at the CDN.
- **Open preview**: `"Edge hit"`, `"Pre-warmed"` (found in the store) or `"Generated on view"` (rendered while the user waits, then stored).

**Non-functional requirements.** Upload p99 under 200 ms and durable; thumbnail views p99 under 100 ms and 99.99% available; preview opens under 1.5 s; new outputs ready within 3 s at p99; any machine can fail; at most $12,500 a month.

**What the tests check:**

- *Uploads never wait for processing*: the upload writes `originals` before answering, sends to a queue, and never calls or waits for a worker pool. Pre-warm starts at the queue.
- *Each transformation has its own worker pool*: pre-warm reads the original before rendering, calls `previewer` only in `"Thumbnail and preview"`, writes `derived` before it finishes, and both pools have at least two workers.
- *Views are served from stored outputs*: thumbnail views go to the CDN before `derived` and never reach a worker or the originals; a pre-warmed preview never reaches a worker; a preview generated on view checks `derived` first and stores its pages before answering.
- *Users reach only the API and the CDN*.

## Back-of-the-envelope

```numbers
1k/s | uploads, each one pre-warm job
640/s | previews to render (600 pre-warmed + 40 on view)
50k/s | thumbnail views
2.5k/s | thumbnail views that miss the edge
400/s | preview opens that reach the coordinator
```

All of these come from the statement's scale, which is an assumption for the exercise: Dropbox has published the platform's total throughput, not per-product rates.

| Quantity | Arithmetic | Result |
|---|---|---|
| Thumbnails to render | 1 per upload | 1,000/s |
| Previews pre-warmed | 60% × 1,000 | 600/s |
| Previews generated on view | 2% × 2,000 | 40/s |
| Thumbnail workers busy | 1,000 ÷ 100 per worker | 10 |
| Preview workers busy | 640 ÷ 40 per worker | 16 |
| Thumbnail views reaching `derived` | 5% × 50,000 | 2,500/s |
| Preview opens past the edge | 20% × 2,000 | 400/s |

Two comparisons make the design obvious. If thumbnails were rendered on every edge miss instead of stored, the thumbnail pool would face 2,500 renders a second from views on top of 1,000 from uploads: three and a half times the work, growing with popularity rather than with new files. And if the upload waited for its preview, its latency would include half a second of rendering plus any queueing in the preview pool.

```callout takeaway
Size the workers by **how many new things need making**, not by how often things are looked at. Views are for the CDN and the store.
```

## Concepts

### Pre-warming in the background

The upload's job is narrow: make the original durable and tell someone there is work to do. It writes the file to object storage, sends a message to a queue, and answers. A message to a queue is fast and does not depend on the workers being healthy, so a backlog of previews never slows an upload.

*Pre-warming* is Dropbox's word for generating outputs ahead of demand: a job from that queue asks the coordinator to make the new file's thumbnail and preview and store them, so that the first viewer finds them ready. It trades CPU and storage now for latency later. Dropbox's 2021 post on the subject says those costs were considerable at their volume, which is why they later trained a model to skip pre-warming previews for files unlikely to be opened; in an offline test it rejected about 40% of pre-warm requests. That is the `"Thumbnail only"` scenario here.

What it costs: an output is not there the instant the upload finishes, so the file list shows a placeholder for a moment, and some pre-warmed previews are never viewed. What it buys: uploads at queue speed, and views that almost never wait for a worker.

```quiz
media-processing-upload-never-waits
queue-load-levelling
```

### Generate once, serve many

A thumbnail of a given version of a file never changes. That makes it the ideal cached object: compute it once, store it under a key that includes the file's version, and serve it to every viewer after that. A new version of the file gets a new key, so nothing ever has to be invalidated.

The store of derived outputs is object storage: durable, cheap per gigabyte and scaling out with requests. Losing an output is not a disaster (it can be regenerated from the original), but regenerating it costs a worker's time, so keeping it is the cheaper choice.

The one exception is a preview nobody made in advance. Then the coordinator checks the store, finds nothing, reads the original, has a preview worker render it and *stores the result before answering*, so the second viewer gets the stored copy. Dropbox's post describes exactly this: on a cache miss, the preview is generated on the fly while the user waits. Keeping that path rare is the point of pre-warming.

```callout pitfall
A read path that renders on a miss and **does not store** the result runs the worker for every miss, forever.
```

```quiz
media-processing-generate-once
hit-rate-to-db-load
```

### Sizing a worker pool

A worker pool is sized like any server pool: the rate it must handle divided by what one worker handles, then headroom. Here a preview worker turns out 40 previews a second, so 640 a second keeps 16 of them fully busy. At 16 they would run at 100%, with no room for a burst or a lost machine. Aim for about 70%: 24 workers run at 67%, and with one lost, 23 run at 70%.

Thumbnails are the same arithmetic with different numbers: 1,000 a second at 100 per worker is 10 busy workers, about 15 with headroom. The two pools come out different sizes because their jobs differ by an order of magnitude in cost, which is the case for keeping them separate.

```deepdive Why one pool per transformation
Riviera gives each kind of transformation its own backend workers. Each pool is then sized, scaled and deployed for its own load, and a flood of expensive document conversions cannot starve cheap thumbnails. A shared pool has to be sized for the sum, and a request's latency depends on what happens to be ahead of it. The coordinator is what keeps this manageable: it composes a request into steps (a PowerPoint preview is a PDF conversion, then a page render) and sends each step to the pool that owns it, so a new format is a new worker type, not a change to every pool.
```

```quiz
workers-needed
media-processing-separate-pools
```

### Serving from the edge

Thumbnails are small, immutable and requested 50,000 times a second. That is a CDN's job. With 95% of views answered at the edge, only 2,500 a second reach the derived store, which four object storage replicas take easily. Without a CDN, all 50,000 would go through your own servers to the store: dozens of API replicas and a much larger store, for bytes that never change.

Previews go through the CDN too. A preview miss at the edge goes to the coordinator rather than straight to the store, because only the coordinator can generate a missing page; Dropbox's post notes that the coordinator caches responses so workers are protected from repeated work.

```quiz
cdn-cache-control
fingerprinted-assets
```

## Designing it step by step

**1. Scope.** Ask which outputs exist (thumbnails, previews), how often each is viewed compared with how often files are uploaded, and whether a user may see a placeholder for a moment after upload. That last answer is what permits doing the work asynchronously.

**2. The write path.** User → upload API → `originals` (synchronous, durable), then an asynchronous send to the queue, then `201`. Nothing about thumbnails or previews here.

**3. The processing path.** "Pre-warm" starts at the queue: the coordinator reads the original, calls the thumbnail pool, calls the preview pool when the file is likely to be opened, writes the outputs to `derived`, and acknowledges the job. Two scenarios, one per decision.

**4. The read paths.** Both start at the CDN. A thumbnail miss reads `derived`. A preview miss goes to the coordinator, which reads `derived` and, only when the page is not there, renders and stores it before answering.

**5. Sizing and checking.** Size the two pools from the arithmetic above, give every component at least two replicas, and check the bill: the preview pool is the largest line. Then read the tests' verdict and the analysis: the upload's p99 should not move when you change the preview pool's size.

## Common mistakes

**Render the thumbnail inside the upload** (`wrong/upload-renders-thumbnail`). Tempting, because the file list then never shows a placeholder. But every upload now waits for a worker, the thumbnail pool takes both the upload's renders and the pre-warm's, and a slow pool slows uploads. It fails *Uploads never wait for processing* and the upload's p99.

**Render again on every edge miss** (`wrong/transform-on-every-view`). The thumbnail is made but never kept, so each CDN miss reads the original and calls the thumbnail pool. The pool's load grows with views, 2,500 extra renders a second, and saturates. It fails *Views are served from stored outputs* and the thumbnail view's p99.

**Size the preview pool like the thumbnail pool** (`wrong/preview-pool-sized-like-thumbnails`). Fifteen workers is right for thumbnails, but a preview worker does 40 a second, not 100, so 15 of them can do 600 against 640 needed. The pool saturates and both pre-warms and on-view previews blow their latency limits.

**Serve thumbnails through the API** (`wrong/thumbnails-through-the-api`). Every thumbnail view goes through your own servers to the store. Those saturate at 50,000 requests a second, and sizing them for it costs more than the budget, for bytes a CDN would serve at the edge. It fails *Views are served from stored outputs* and the thumbnail view's p99.

**Other classic mistakes.**

- *Letting clients fetch from the derived bucket directly.* It skips the CDN and exposes storage; it fails *Users reach only the API and the CDN*.
- *Generating on view without storing.* The preview path's `"Generated on view"` must write `derived` before answering, or the next viewer pays again.
- *Pre-warming everything.* It works, but it spends CPU and storage on previews nobody opens. Dropbox found it worth a model to decide.

## In the interview

Open with the asymmetry: "a transformation is expensive and its output is immutable, so do it once, off the request path, and cache the result everywhere." Then draw three paths: upload, processing, view.

```callout interview Name the miss path
Say what happens when a view finds nothing: the coordinator renders it while the user waits, stores it, and that is rare because of pre-warming. Interviewers probe this.
```

Likely questions, with short answers:

- *What if a job is lost or a worker crashes?* The queue redelivers it; a render is idempotent because the output key is the file version, so doing it twice overwrites the same object.
- *Two viewers open a preview that was not pre-warmed at the same moment?* Both would render it. Coalesce concurrent requests for the same key at the coordinator, or take a short lock per key.
- *Which files should be pre-warmed?* The ones likely to be viewed. Dropbox used a model based on file type and recent account activity; a simple rule (file type, size) is a fair first answer.
- *How do you add a new format?* A new worker type plugged into the coordinator, reusing existing steps such as PDF to image.
- *What do you monitor?* Queue age per transformation, worker utilisation per pool, the share of previews generated on view, and CDN hit rate.

## Further reading

- Andrew Cheung and Binoy Dash, [How our universal content processing platform Riviera evolved for AI and beyond](https://dropbox.tech/infrastructure/how-our-universal-content-processing-platform-riviera-evolved-for-ai-and-beyond), Dropbox Tech Blog, 2026: the coordinator, one worker type per transformation, transformation chains, and shared outputs.
- Win Suen, [Cannes: How ML saves us $1.7M a year on document previews](https://dropbox.tech/machine-learning/cannes--how-ml-saves-us--1-7m-a-year-on-document-previews), Dropbox Tech Blog, 2021: pre-warming, its cost, and predicting which files to pre-warm.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism): message and task queues.
- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network): push and pull CDNs.
- *Designing Data-Intensive Applications* (Martin Kleppmann), Part III "Derived Data" and its chapter "Batch Processing": derived data as something recomputed from a source of truth.
