# File Storage: keep the bytes off your servers

A small Dropbox sounds like a CRUD app (create, read, update, delete) with big rows. It is not. The moment files range from a 10 KB note to a 2 GB video, the design question changes from "where do I store this?" to "which machines should the bytes travel through, and who pays for them on the way out?" This lesson builds the answer: pre-signed URLs for uploads, bucket events to finish them, and a CDN for downloads.

## What you'll learn

- How pre-signed URLs let clients upload straight into object storage while your API keeps control.
- Why the bucket, not the client, should tell you an upload finished, and how event notifications plus a queue do it.
- How to estimate bandwidth and egress (data sent out of your system), and why egress usually dominates the bill of a file service.
- When a CDN helps (cost, offload) and when it barely changes latency.
- How to split metadata (a database) from content (object storage).

## The problem, explained

**Who uses it.** People with several devices who want their files everywhere: upload a report on a laptop, open it on a phone.

**Functional requirements.**

- **List files**: open a folder, get names, sizes and a signed download link for each file.
- **Start upload**: ask to upload; the API records the file as *pending* in the metadata store and answers `201` with a pre-signed URL that permits one `PUT` into the bucket.
- **Upload**: the client `PUT`s the bytes straight into object storage. Once stored, the file must be marked *ready* without the client's help, because the client may already be offline.
- **Download**: the client fetches through its signed link, which points at a CDN. Two scenarios: `"CDN hit"` (the edge has it) and `"CDN miss"` (the edge fetches from the bucket).

**Non-functional requirements.** p99 under 200 ms for listing, starting an upload and downloading, and under 220 ms for the upload itself, transfer time included. Every use case available 99.9%. Uploads are acknowledged only when the bytes are durable; the pending record exists before the URL is handed out. Clients never reach the metadata store. Any single machine can fail. At most $45,000 a month, egress included.

**What is given.** `given.proschi` declares the `user` and the bucket `blobs` (S3 with two partitions). Object storage is given because it is not the interesting choice: every cloud has one, and it scales by itself. The interesting choices are everything around it.

**What the tests check.**

- *File bytes never pass through your servers*: in Upload the user calls the bucket directly, and in Upload and Download no service or function ever calls the bucket. Upload also never touches a load balancer or other edge node.
- *The API hands out pre-signed URLs for pending files*: Start upload writes a database before answering, answers 201 and never calls the bucket (signing a URL is a local computation, not a call).
- *Uploads are finished without the client*: Upload starts at the user, the user calls nothing but the bucket, and a database is written *after* the bucket.
- *Downloads are served by the CDN*: both scenarios exist, the user calls a CDN and never the bucket, a hit never reaches the bucket, and the CDN comes before the bucket.
- *Metadata stays behind the API*: no path from the user to any database.

## Back-of-the-envelope

The problem gives the rates and an average file of 1 MB. A month in the model is 30 days, 2,592,000 seconds.

| Quantity | Arithmetic | Result |
|---|---|---|
| Download bandwidth | 500 rps × 1 MB | 500 MB/s |
| Downloaded per month | 500 MB/s × 2,592,000 s | 1,296,000 GB ≈ 1.3 PB |
| Egress if the bucket sends it | 1,296,000 GB × $0.09 | about $116,600/month |
| Egress if the CDN sends it | 1,296,000 GB × $0.02 | about $25,900/month |
| Bucket reads with 90% CDN hits | 10% × 500 rps | 50 rps |
| Upload bandwidth (ingress, free) | 200 rps × 1 MB | 200 MB/s |
| New data per month | 200 MB/s × 2,592,000 s | about 518 TB |
| API requests | 2k list + 200 start | 2.2k rps |
| Metadata writes | 200 inserts + 200 updates | 400 rps |
| Transfer time for 1 MB at the user's 10 MB/s | 1 MB ÷ 10 MB/s | 100 ms |

Three things jump out.

**Egress decides the design.** Sending 1.3 PB from the bucket alone costs more than twice the whole budget. Sending it from a CDN fits with room. No amount of clever compute changes that, so the CDN is not an optimisation here; it is a requirement hiding in the cost line.

**Transfer time sets the latency floor.** A 1 MB file over a 10 MB/s connection takes 100 ms no matter what. In Proschi, payload transfer is a fixed cost that adds once to every percentile, so a 200 ms p99 budget has only about 100 ms left for everything else. Every extra hop that also carries the bytes eats into it.

**Storage grows fast.** About half a petabyte of new files a month. Proschi's cost model has no storage-at-rest price, but in an interview you should mention lifecycle rules (move cold files to cheaper storage classes) and deduplication.

**How the model sees each piece.** A load balancer takes 100k rps per replica, a service 2k, PostgreSQL 20k reads but 5k writes on its single primary, a queue 50k, a function 10k, storage 5k. With 2.2k API requests a second, about two service replicas would be fully busy. Divide by your target utilisation, and check that one replica fewer still survives. Metadata writes are far below one primary's capacity, so no sharding is needed. Object storage and CDNs "scale out behind one name": the model never saturates them on bandwidth, which matches how they behave in reality.

**Availability.** A write to a single-primary database with two replicas is modelled at 99.995% (failover costs 10% of the primary's downtime). That is the weakest link for Start upload, still well above 99.9%.

## Concepts

### Object storage and pre-signed URLs

*Object storage* (S3, GCS, Azure Blob) stores immutable blobs under keys. It is cheap per byte, extremely durable, and scales request rates and bandwidth for you. What it is not: a database you can query, or a file system with cheap renames.

A *pre-signed URL* is a URL that carries a signature made with your credentials. It allows one operation (say, a `PUT` to one key) and expires after a few minutes. Your API decides who may upload what, signs the URL locally (no network call), and hands it to the client. The client then talks to the bucket directly. Your servers never see the bytes, so they need neither the bandwidth nor the long-lived connections a 2 GB upload would hold.

Trade-offs: you cannot inspect the bytes on the way in, so virus scanning and transcoding happen later, on an event. URLs can leak until they expire, so keep expiry short and scope each URL to one key. And something must tell your system that the upload happened, which is the next concept.

When *not* to use it: tiny payloads that are really part of an API call (an avatar crop, a 2 KB JSON), where an extra round trip costs more than proxying.

```proschi
title "Direct-to-bucket upload"

phone  "Phone"     [Actor]
api    "Media API" [REST API]   x2
db     "Media DB"  [PostgreSQL] x2
bucket "Bucket"    [AWS S3]     x2

phone -> api    : HTTPS
phone -> bucket : PUT pre-signed
api   -> db     : SQL

usecase "Get upload URL" {
  phone -> api   : POST /media
  api   -> db    : INSERT media status=pending
  db   --> api   : ok
  api  --> phone : 201 {"putUrl": "https://bucket.example.com/m1?sig=..."}
}

usecase "Put bytes" {
  phone   -> bucket : ~5MB PUT /m1?sig=...
  bucket --> phone  : 200
}
```

### Event-driven completion

After the `PUT`, someone must flip the record from *pending* to *ready*. The naive answer is "the client calls `/complete`". But phones lose signal, laptops close, apps crash. A client that disappears leaves a file pending forever.

The robust answer: the bucket itself announces new objects. S3 event notifications can deliver an `ObjectCreated` event to SQS, SNS, Lambda or EventBridge. Put a queue in between so events survive a slow or failing consumer, and let a worker or function mark the file ready. If the worker crashes, the queue redelivers. Because delivery is at-least-once, the update must be idempotent: setting `status=ready` twice is harmless, which is why it is a good shape for this step.

Trade-offs: a short delay between the `PUT` finishing and the file appearing as ready; the client should poll or be pushed the state change. When not to use it: if you need the upload's result synchronously (for example, a server-side validation that must reject the file before the user moves on), you need a synchronous step, usually a proxy or a post-upload check the client waits for.

```proschi
title "Object events"

bucket "Bucket"      [AWS S3]     x2
events "Object Feed" [AWS SQS]    x2
fn     "Indexer"     [AWS Lambda] x2
db     "Catalog"     [DynamoDB]   x2

bucket -> events : ObjectCreated
events -> fn     : trigger
fn     -> db     : write

usecase "Index new object" {
  bucket ->> events : ObjectCreated img/42.jpg
  events ->> fn     : ObjectCreated img/42.jpg
  fn      -> db     : UPDATE item 42 status=indexed
  db     --> fn     : ok
}
```

### CDNs for large downloads

A *CDN* is a fleet of caching proxies near users. On a *hit*, the edge serves the file from its cache; on a *miss*, it fetches from the *origin* (here, the bucket), keeps a copy and serves it. This is a *pull CDN*, the kind the System Design Primer recommends for heavy traffic.

Two different benefits, often confused:

- **Offload and cost.** Hits never reach the origin, and CDN egress is cheaper than origin egress. Here, that is the difference between blowing and fitting the budget.
- **Latency.** Edges are closer to users. But for big files, the user's own bandwidth dominates. Proschi's model shows this: a 1 MB download takes at least 100 ms at the client's 10 MB/s whether a CDN or a bucket sends it.

When not to use a CDN: highly personalised content that is never reused, or tiny traffic where the fixed cost outweighs savings. Private files are fine on a CDN as long as links are signed and short-lived.

## Designing it step by step

**1. Scope.** Ask: file sizes (up to 2 GB, so streaming through servers is out), read/write ratio (downloads plus listings far outnumber uploads), whether files are shared (yes, by link, hence signed URLs), and the cost constraint. Confirm sync, versioning and conflict resolution are out of scope; they are great follow-ups but not this problem.

**2. High-level design.** Separate *metadata* from *content*:

- Metadata (folder, name, size, status, object key) lives in a relational database behind an API, behind a load balancer. It is small, structured and queried by folder.
- Content lives in the bucket and only ever moves between the user, the bucket and the CDN.

Then sketch the four use cases. List files: user → load balancer → API → database. Start upload: the same path, with an insert of a pending row and a `201`. Upload: user → bucket, then the bucket's event travels to a finisher. Download: user → CDN, and on a miss CDN → bucket.

**3. Deep dive.**

- *Mark the payloads.* Put `~1MB` on the steps that carry file bytes: the user's `PUT`, the user's `GET` to the CDN, and the CDN's origin fetch. Without it the model sees no transfer time and no egress, and your numbers will be fantasy.
- *Who finishes the upload.* Use an async chain from the bucket (`->>`) through a durable queue to a function or worker that updates the database. Make sure that update comes *after* the bucket in the Upload flow.
- *Sizing.* Two replicas of everything is the floor for `survive any node failure`. The API is the only tier with meaningful load; size it from 2.2k rps at 2k per replica, with headroom and one replica lost. The database is fine with a primary and a replica.
- *Cost check.* Add up flat replica prices (a few thousand dollars at most) and egress. If your egress line says $116k, the bytes are leaving from the wrong place.

**4. Wrap-up.** Walk the requirements: upload p99 is the 100 ms transfer plus the bucket's write; download p99 is the transfer plus a CDN hop, with 10% misses adding the origin fetch; nothing is a single replica; the client never sees the database. Then list improvements: multipart uploads for large files (resume after a dropped connection), content hashing for deduplication, a sweeper that deletes pending rows whose upload never arrived, and lifecycle tiers for cold data.

## Common mistakes

**Proxying the upload through the API** (`wrong/upload-through-api`). The most common instinct: the client sends bytes to your API, which forwards them to the bucket. In the real world, each 2 GB upload pins an API connection for minutes and your API fleet scales with bandwidth instead of requests. In the model, the extra hops (load balancer, API, and a second transfer between API and bucket) push the upload's p99 over 220 ms. It fails *File bytes never pass through your servers* and `p99 of Upload < 220 ms`.

**The client marks its own upload complete** (`wrong/client-marks-upload-complete`). After the `PUT`, the client calls `POST /files/{id}/complete`. It works in the demo, then leaves orphaned pending files every time a phone loses signal at the wrong moment. It fails *Uploads are finished without the client*, because the user calls the load balancer during Upload.

**Downloading straight from the bucket** (`wrong/download-from-bucket`). Signed bucket URLs are simple and correct, but every byte leaves at $0.09/GB. The model puts the bill around $119k a month, far over $45k. It fails *Downloads are served by the CDN* and `cost ≤ $45,000/month`.

**A load balancer where the CDN should be** (`wrong/load-balancer-instead-of-cdn`). A load balancer distributes traffic but caches nothing, so every download still reaches the origin and egress is still billed at the higher rate. It fails *Downloads are served by the CDN*, because the selector `any cdn` does not match a load balancer.

**Other classic mistakes.**

- *Letting clients read metadata directly* (a public database endpoint or a client SDK with database credentials). Fails *Metadata stays behind the API*, and in reality it is a security hole.
- *Handing out the URL before recording the pending file.* If the insert fails afterwards, you have an object in the bucket that no row points to. The test requires the database write before the `201`.
- *Storing file bytes in the database.* Blobs bloat backups and replication; keep only the object key.

## In the interview

Open with the two numbers that drive everything: "Downloads move about 1.3 PB a month, and a 1 MB file takes 100 ms on a user's connection." Then state the principle: "Our servers handle metadata and authorisation; bytes go client ↔ bucket ↔ CDN." Draw the metadata path and the byte path in different colours if you can.

Likely follow-ups:

- *How do you upload a 2 GB file reliably?* Multipart upload: the API signs a URL per part; the client uploads parts in parallel, retries failed parts, and completes the upload. The completion event still drives the ready state.
- *How do you stop someone sharing a download link forever?* Short-lived signed URLs, re-issued by List files; revoke by changing permissions in metadata.
- *What if the event is delivered twice, or late?* The finisher's update is idempotent; late is fine because the client sees "processing" until it lands.
- *What about a pending file whose upload never arrived?* A periodic job deletes pending rows older than the URL's expiry.
- *How would you add sync across devices?* A change log per user in metadata, and a notification channel (long polling or websockets) that tells devices to pull changes.
- *How do you deduplicate?* Hash content on the client; if the hash exists, skip the upload and reference the existing object.

## Further reading

- [Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html), Amazon S3 User Guide: how upload URLs are scoped and what happens when one is used.
- [Amazon S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html), Amazon S3 User Guide: the event types and destinations (SQS, SNS, Lambda, EventBridge).
- [Amazon SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html), Amazon SQS Developer Guide: why consumers must be idempotent.
- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network): push versus pull CDNs and their costs.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): links to Dropbox's engineering posts, including "Inside the Magic Pocket", their in-house storage system.
- [awesome-system-design-resources](https://github.com/ashishps1/awesome-system-design-resources): a curated list with a "Design File Sharing System like Dropbox" entry among its interview problems.
- *System Design Interview – An Insider's Guide, Volume 1* (Alex Xu), chapter "Design Google Drive"; Volume 2, chapter "S3-like Object Storage".
