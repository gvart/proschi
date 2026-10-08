# Video upload and streaming: follow the bytes

```tldr
Request rates are modest; **bytes are not**. Creators upload 2 GB originals **straight to object storage** with presigned URLs, a **storage event on a queue** feeds a transcoder fleet at its own pace, and viewers stream immutable segments from a **CDN**, the only place 104 PB a month can leave within budget.
```

## What you'll learn

- How to estimate bandwidth and egress, and why for video they decide the design more than request rates do.
- How **presigned URLs** let clients upload large files straight to object storage, so your servers never touch the bytes.
- How a **transcoding pipeline** works: storage events, a queue and a worker fleet that runs at its own pace.
- What a **CDN** does for immutable video segments, and why a load balancer in front of storage is not one.
- How HLS (HTTP Live Streaming) splits video into small segments, and what that means for caching.

## The problem, explained

Think of a small YouTube: creators upload videos, viewers watch them. Four use cases:

- **Upload video**: the creator registers a video (title, size), recorded as *uploading*, and gets `201` with an upload URL, then sends the ~2 GB file **straight to object storage** with it. When the file lands, storage announces it for transcoding.
- **Transcode video**: a queue hands one original to a transcoder, which reads it, writes the HLS renditions back to storage, and marks the video *ready*. A rendition is the video at one resolution, cut into segments a few seconds long.
- **Open video**: a viewer opens the video page and gets the title, status and manifest URL, usually from a cache (`"Cache hit"`), sometimes from the database (`"Cache miss"`).
- **Stream video**: the player fetches the next 4 MB segment, from the edge (`"Edge hit"`) or, on a miss, from where renditions are stored (`"Edge miss"`).

The non-functional requirements:

- Transcoding never runs while the creator waits, and a queue feeds it (upload p99 under 1 s).
- The video is recorded durably before the URL is handed out.
- No server of yours touches the upload bytes.
- Opening a video: p99 under 75 ms. A segment: p99 under 600 ms, transfer included.
- Streaming is available 99.99% of the time, and the system survives the loss of any machine.
- At most $2.5M a month, bandwidth included.

The given declares the creator, the viewer and the **transcoder** fleet: 10 workers, each taking a job about every two seconds (0.5 rps), where a job takes 60 s. Traffic: 2 uploads and 2 transcodes a second, 5k page opens and 10k segment requests a second.

The tests encode the key ideas:

- In "Upload video" the creator calls storage directly, and no service or function calls storage; the database is written before the `201`.
- The upload never waits for the transcoder and calls a queue; "Transcode video" starts at a queue, calls the transcoder, and marks the database after touching storage.
- Streaming goes to a CDN before storage, a hit never touches storage, no service is involved, and there is **no path at all from the viewer to storage**.
- Video pages read a cache before the database, and a hit never touches the database.

## Back-of-the-envelope

Request rates are modest here. Bytes are not.

```numbers
40 GB/s | streamed to viewers
≈ 104 PB | leaving per month
≈ $9.3M | monthly egress from storage
≈ $2.1M | monthly egress from a CDN
400 ms | to deliver one 4 MB segment
200 s | to upload a 2 GB original
```

**Streaming bandwidth.** 10k segments a second × 4 MB = 40 GB/s to viewers. Over a 30-day month (2,592,000 s): about 103,680,000 GB, roughly **104 PB**. Sanity check: 40,000 concurrent viewers each fetching 4 MB every 4 s is 1 MB/s each, or 8 Mbit/s, a plausible 1080p bitrate.

**Egress cost.** This is what the budget is really about.

| Served from | Price per GB (model) | Monthly egress |
|---|---|---|
| Object storage, or a load balancer / service in front of it | $0.09 | ≈ $9.3M |
| CDN | $0.02 | ≈ $2.1M |

```callout takeaway Only the CDN fits
Under $2.5M, only CDN egress works. A load balancer in front of storage does not help: the bytes still leave from something you run, at the higher price. Traffic between your own nodes (a CDN filling from storage, a transcoder reading an original) is free in the model.
```

**Transfer time.** The model adds payload size ÷ the slower end's bandwidth to every percentile. At a viewer's 10 MB/s a 4 MB segment takes 400 ms to arrive, leaving about 200 ms of the 600 ms p99 for everything else. The CDN's 5 ms is fine; one extra slow hop is not.

For the upload, 2 GB at 10 MB/s is **200 seconds**: before the `201`, the 1 s limit is impossible. So the creator gets the `201` first and sends the bytes after the response, outside the request's latency.

**Transcoding.** 2 uploads a second × 60 s = 120 videos in flight on average. The fleet takes 10 × 0.5 = 5 jobs a second, so 2 is 40%. Real uploads come in bursts (a creator conference, a time zone waking up); the queue holds what the fleet cannot take right away.

**The rest is small.**

| Load | Arithmetic | Result |
|---|---|---|
| Segment requests reaching storage | 10k × 1% (99% edge hits) | 100 rps, trivial |
| Page reads reaching the database | 5k × 5% (95% cache hits) | 250 rps |
| Metadata API | 5k page opens at 2k rps per replica | a few replicas |

Storage, queue and cache are two replicas each for availability.

## Concepts

### Direct uploads with presigned URLs

A **presigned URL** points at an object in a bucket, signed with your credentials, and grants one operation (here, `PUT` of one key) for a limited time. Your API checks the user, records the video, signs the URL and returns it; the client uploads straight to storage.

**Why.** Object storage absorbs large, slow uploads from millions of clients at no server time to you. 2 GB through your API means a request lasting minutes, load balancer and API replicas busy copying bytes, and a retry from zero if anything fails. Multipart uploads (chunks uploaded independently, then combined) also make uploads resumable.

**When not to use it.** Small payloads you must inspect or transform synchronously (a profile picture you resize before saving), or uploads that must be scanned before they land anywhere.

```proschi
title "Direct upload"
client "Client" [Actor]
api    "API"    [REST API] x2
db     "DB"     [PostgreSQL] x2
bucket "Bucket" [AWS S3] x2
client -> api
client -> bucket : presigned PUT
api    -> db     : SQL

usecase "Upload file" {
  client  -> api    : POST /files json {"name": "a.zip"}
  api     -> db     : INSERT file status uploading
  api    --> client : 201 {"uploadUrl": "…"}
  client  -> bucket : ~50MB PUT /files/a.zip
  bucket --> client : 200
}
```

```quiz
presigned-upload
multipart-upload
```

### Transcoding pipelines

**Transcoding** decodes the original, re-encodes it at several resolutions and bitrates, and cuts each rendition into short segments with a manifest (a playlist) listing them. It takes minutes of CPU per video: a textbook background job.

The robust shape:

1. Storage emits an **event** when an object is created (S3 Event Notifications can deliver to SQS). Only storage knows the file really landed, which beats the client saying "I'm done".
2. A **queue** holds one message per original. It decouples the upload rate from the fleet's, keeps jobs while every worker is busy, and redelivers a job whose worker crashed.
3. A **worker fleet** pulls jobs at its own pace, reads the original, writes renditions to storage, and updates the video's status last, once the renditions exist.

Real pipelines split the work further (per resolution, or per chunk in parallel) and run quality checks, thumbnails and captions as separate steps, often as a directed graph of tasks.

**When not to use a queue.** Work that takes milliseconds and whose result the user needs now: a queue only adds latency and a moving part.

```quiz
upload-completion-events
claim-check
```

### CDNs for immutable segments

A **CDN** (content delivery network) is a fleet of caches close to users. It serves an object from the local cache if it has it, or fetches it from the **origin** (here, the bucket), keeps a copy and serves it.

Video segments are the ideal CDN payload: **immutable** (nothing to invalidate) and **popular** (many viewers watch the same few videos at once), so hit rates are very high. The CDN also serves from nearby, and its egress is far cheaper than from things you run.

```callout pitfall A load balancer is not a CDN
It spreads requests over servers but keeps no copies, so every request still reaches storage and every byte leaves at storage's price.
```

Netflix takes the CDN idea to the extreme with Open Connect: its own caching appliances inside internet providers' networks. A CDN does not help with content requested once (a private video) or content that changes per request.

````deepdive A CDN in front of storage, in Proschi
```proschi
title "CDN in front of storage"
viewer "Viewer" [Actor]
cdn    "CDN"    [AWS CloudFront] x2
bucket "Origin" [AWS S3] x2
viewer -> cdn
cdn    -> bucket : origin fetch

usecase "Get image" {
  viewer -> cdn : ~1MB GET /img/1.jpg
  alt "Edge hit" when "cached at the edge" {
    cdn --> viewer : 200
  } alt "Edge miss" when "first request at this edge" {
    cdn     -> bucket : GET /img/1.jpg
    bucket --> cdn    : 200
    cdn    --> viewer : 200
  }
}
```
````

```quiz
hls-segments-cache
```

## Designing it step by step

**1. Scope.** Separate the two halves: an upload pipeline (rare, heavy, asynchronous) and a playback path (constant, read-only, bandwidth-bound). Confirm sizes (2 GB originals, 4 MB segments), rates, and that ready means "renditions exist". Ask about live streaming and say you will leave it out.

**2. High level.** An API behind a load balancer for metadata (register uploads, serve video pages), a relational database for video records, a cache for popular pages, object storage for originals and renditions, a queue fed by storage events, the transcoder fleet, and a CDN with storage as its origin. Draw the four use cases.

**3. Deep dive.**

*The upload.* Explain why the bytes skip the API, and the order: insert the video as *uploading*, return the presigned URL, then the client's `PUT` to storage after the response. Storage announces the new object on the queue with an async send.

*The pipeline.* The transcoder consumes, reads the original, writes renditions, then updates the status. Talk about retries and idempotency (running a job twice has the same effect as once): a redelivered job overwrites the same rendition keys.

*Playback.* Do the egress arithmetic out loud: it is the most convincing argument in the interview. Then put the CDN in front of the bucket, make segments immutable with long cache lifetimes, and keep the manifest short-lived if it can change.

*Video pages.* Cache-aside: read the cache; on a miss, read the database and refill the cache asynchronously.

*Failure.* Two of everything you run; the queue retains jobs while transcoders are replaced.

**4. Wrap up.** Mention adaptive bitrate (the player switches resolution segment by segment), multi-CDN for resilience and price, prewarming the CDN for a big premiere, storage tiers for cold originals, and what to monitor (rebuffering rate, CDN hit ratio, queue age).

## Common mistakes

**Upload through the API** (`wrong/upload-through-api`). The API receives the 2 GB and writes it to storage: servers spend their bandwidth copying files, the request lasts minutes, and one failure restarts the upload. Caught by **"The file goes straight to object storage, never through a server"**; the 2 GB on the request also breaks the upload and page latencies.

**The upload request carries the file** (`wrong/upload-request-carries-file`). Subtler: the design is otherwise right, but the 2 GB rides on the initial `POST`, putting 200 seconds of transfer on the critical path. Caught by **p99 of Upload video < 1000 ms**.

**Transcode while the creator waits** (`wrong/transcode-while-waiting`). The API calls the transcoder before answering. In production the request times out, and a burst of uploads needs a fleet sized for the peak. Caught by **"Transcoding is queued, never in the request path"**, and the minute-long call blows the upload p99.

**Jobs without a queue** (`wrong/jobs-without-queue`). The API calls the transcoder directly, asynchronously or not. When every worker is busy or one crashes, the job is lost, and the API would have to know the original arrived, which it cannot. Caught by **"Transcoding is queued, never in the request path"** ("Transcode video" must start at a queue).

**Segments from storage** (`wrong/segments-from-storage`). Viewers read the bucket directly. Latency is similar, since the viewer's bandwidth dominates, but every byte is billed at $0.09/GB: over $9M a month. Caught by **cost ≤ $2,500,000/month** (and the CDN flow test).

**A load balancer instead of a CDN** (`wrong/load-balancer-instead-of-cdn`). It looks like an edge but caches nothing: storage still serves every segment, and the load balancer sends every byte through its own bandwidth at the expensive rate. Caught by **"Segments are served by a CDN, with storage as its origin"**, plus latency, failure and cost limits.

## In the interview

Present the upload path and the playback path as two separate systems that share storage and metadata.

```callout interview Open with the asymmetry
"Two uploads a second, but 40 GB/s out. The design is mostly about where those bytes come from."
```

Likely follow-ups:

- *How does the player pick a resolution?* The manifest lists renditions; the player measures its throughput and switches renditions between segments (adaptive bitrate). HLS and DASH both work this way.
- *A creator's upload fails at 90%.* Multipart upload: each part is retried independently and the object is assembled at the end.
- *How do you know transcoding finished?* The worker updates the status last, after the renditions; the page reads it. Optionally notify the creator through a queue.
- *A video goes viral in a minute.* Segments are immutable, so the CDN absorbs it after the first miss per edge; consider request collapsing at the CDN so a burst of misses becomes one origin fetch.
- *How do you cut the CDN bill further?* Better codecs (fewer bytes per minute), tuned bitrate ladders, negotiated or tiered CDN pricing, or your own appliances inside ISPs, like Netflix's Open Connect.

## Further reading

- [RFC 8216: HTTP Live Streaming](https://www.rfc-editor.org/rfc/rfc8216) (Pantos and May, 2017) — the HLS protocol: playlists, media segments and how clients switch renditions.
- [Amazon S3: Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html) — letting a client upload without your credentials or your servers.
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html) — announcing new objects to SQS and other destinations (delivered at least once).
- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network) — push versus pull CDNs and their downsides.
- [System Design Primer: Asynchronism](https://github.com/donnemartin/system-design-primer#asynchronism) — message queues, task queues and back pressure.
- [Netflix Open Connect](https://openconnect.netflix.com/en/) — Netflix's own CDN appliances, embedded in internet providers' networks.
- Alex Xu, *System Design Interview – An Insider's Guide, Volume 1*, chapter "Design YouTube" — the same problem at interview depth: uploading, transcoding and streaming.
