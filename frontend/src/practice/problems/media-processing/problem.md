---
title: File Previews and Thumbnails
summary: "Dropbox's Riviera: render each output once, in the background, and serve it from a CDN."
difficulty: medium
company: Dropbox
tags: [queues, async, cdn, object-storage, read-heavy, real-world]
hints:
  - "A preview takes half a second of worker time. Can the upload wait for that? What can hold the work until a worker is free?"
  - "The upload stores the original, then sends a job to a queue (api ->> jobs) and answers 201. \"Pre-warm\" starts at that queue: a coordinator reads the original, asks the thumbnail workers and, for files likely to be opened, the preview workers, and stores what they return in derived."
  - "A thumbnail never changes once it is made. Views go to a CDN; an edge miss fetches the stored output from derived and never runs a worker. Only \"Generated on view\" of Open preview calls previewer, and it stores the pages in derived before answering."
  - "Size each pool from its own numbers: 1k thumbnails a second at 100 per worker, 640 previews a second (600 pre-warmed, 40 on view) at 40 per worker. Keep both under about 70% with one worker lost: about 15 thumbnail workers and 24 preview workers."
---

Every file in Dropbox gets a thumbnail in the file list, and most documents
can be opened as a preview in the browser without downloading them.
Dropbox's content processing platform, Riviera, makes those derived outputs:
a central coordinator takes each request, checks for a stored result, and
dispatches the work to pools of workers, one pool per kind of
transformation. A PowerPoint deck, for example, is converted to PDF and each
page rendered as an image.

The expensive part is the transformation; the cheap part is serving its
result again. So Riviera *pre-warms*: it generates the outputs of new files
in the background, before anyone asks, and stores them. When a preview was
not pre-warmed, it has to be generated while the user waits.

Design the upload, the background generation and the two read paths.

## Functional requirements

- **Upload file**: a user uploads a file and gets `201` once the original
  is stored durably in `originals`. Its outputs are generated later.
- **Pre-warm**: a job from the queue asks the coordinator to generate a new
  file's outputs. The coordinator reads the original, gets a thumbnail from
  the thumbnail workers, and stores the outputs in the derived-output store.
  Two scenarios:
  - `"Thumbnail and preview"`: the file is likely to be previewed, so the
    preview workers also convert it and render its pages.
  - `"Thumbnail only"`: the file is unlikely to be previewed, so no preview
    is made in advance.
- **View thumbnail**: a file list shows a thumbnail. Two scenarios:
  `"Edge hit"` (the CDN has it) and `"Edge miss"` (the CDN fetches it from
  the derived-output store).
- **Open preview**: a user opens a file's preview. Three scenarios:
  - `"Edge hit"`: the CDN has the page.
  - `"Pre-warmed"`: the coordinator finds the page in the derived-output
    store.
  - `"Generated on view"`: the page is not stored yet; the coordinator
    reads the original, has the preview workers render it, and stores the
    pages before answering, so the next viewer finds them.

Name the thumbnail workers `thumbnailer`, the preview workers `previewer`
and the derived-output store `derived`: the capacity and the tests in
`problem.proschi` refer to them, and to the use case and scenario names
above.

## Scale

- **1k uploads** a second, each followed by one pre-warm job; about **40%**
  of pre-warms make the thumbnail only.
- **50k thumbnail views** a second, **95%** of them answered at the edge.
- **2k preview opens** a second: **80%** at the edge, **18%** from the
  stored pre-warmed pages, **2%** generated on view.
- A thumbnail worker renders **100 thumbnails a second** in about
  **50 ms** each; a preview worker renders **40 previews a second** in
  about **500 ms** each. Both are set in `problem.proschi`'s `capacity`.

The rates and worker speeds are assumptions for the exercise: Dropbox has
published only the platform's total, hundreds of thousands of
transformations a second.

## Constraints

- An upload never waits for a transformation: p99 under **200 ms**, available
  **99.9%** of the time, and durable before it answers.
- A thumbnail view never runs a worker: p99 under **100 ms**, available
  **99.99%** of the time.
- p99 of opening a preview under **1.5 s**, the rare on-view generation
  included.
- A new file's outputs are generated with a p99 under **3 s**.
- Users reach only the API and the CDN: never the stores or the workers.
- Losing any single machine must not break a latency limit.
- At most **$12,500 / month**, both worker pools included.

## What is given

`problem.proschi` declares the `user` and `originals`, the object storage
that already holds the uploaded files (four replicas), the speed and price
of a thumbnail worker and of a preview worker, the traffic, the requirements
and the tests. Add the upload API, the queue, the coordinator, the two
worker pools, the derived-output store, the CDN, the connections and the
four use cases.

## What this model leaves out

- Whether a file is *likely to be previewed* is a scenario share here.
  Dropbox decides it per file with a model (Cannes, in the Based on posts);
  the simulation does not predict anything, so the 60/40 split is fixed.
- Transformation chains (PowerPoint to PDF to page images, with the PDF step
  shared by other outputs) are one step to `previewer`. Reusing an
  intermediate output is not modelled.
- The coordinator's check for a stored result is drawn as a read of
  `derived`; two requests for the same new file at the same moment would
  both generate it, and request coalescing is not simulated.
- The size of each file and output, its transfer time and egress are left
  out: the problem is about where the work runs, not the bytes.

## Based on

- Andrew Cheung and Binoy Dash,
  [How our universal content processing platform Riviera evolved for AI and beyond](https://dropbox.tech/infrastructure/how-our-universal-content-processing-platform-riviera-evolved-for-ai-and-beyond),
  Dropbox Tech Blog, July 2026: Riviera began as the preview service and
  became a shared platform; a central coordinator validates requests,
  caches responses and dispatches work to backend workers that each handle
  one kind of transformation; transformations chain (PowerPoint to PDF to
  page images); a 160×160 thumbnail is generated once and reused by
  previews and machine learning; more than 300 file formats, more than 100
  capabilities and hundreds of thousands of transformations a second.
- Win Suen,
  [Cannes: How ML saves us $1.7M a year on document previews](https://dropbox.tech/machine-learning/cannes--how-ml-saves-us--1-7m-a-year-on-document-previews),
  Dropbox Tech Blog, January 2021: Riviera pre-generates and caches preview
  assets (pre-warming); on a cache miss it generates the preview on the fly
  while the user waits; pre-warming's CPU and storage costs are
  considerable; a model that skipped files unlikely to be previewed rejected
  about 40% of pre-warm requests in an offline test, replacing an estimated
  $1.7M a year of pre-warm cost with $9K of ML infrastructure.
