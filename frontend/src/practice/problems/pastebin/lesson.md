```tldr
**Text in object storage**, a small **row per paste in a database**, and **expiry checked on the row** before the body is fetched. A **CDN** in front answers 90% of reads at the edge, and is the only way to fit **egress** into the $6,000 budget.
```

## What you'll learn

- Why large blobs belong in **object storage** and only small, queryable rows belong in a **database**.
- How a **CDN** (content delivery network) answers popular reads at the edge, the only way to meet a 30 ms target.
- How **bandwidth and egress** turn into money, and why the same bytes cost four and a half times more from your API than from a CDN.
- How to handle **expiry** cheaply: check a small row before fetching a big body, and bound how long a cached copy can outlive its paste.

## The problem, explained

Developers use Pastebin to share a stack trace, a log or a config file: paste the text, get a short link, post it in a chat. Everyone in the chat opens it within minutes, then almost nobody opens it again.

The two use cases:

- **Create paste**: a user posts text and an optional expiry (one hour to one year) and gets a short id back with `201`.
- **Read paste**: anyone opens `/<id>` and gets the text. Its three scenario names matter, because the tests use them:
  - `"Cached"`: read recently; the CDN answers from its edge cache.
  - `"Not cached"`: the paste has to be looked up and fetched.
  - `"Expired"`: the reader gets `404` and the text is never fetched.

The non-functional requirements:

- **Scale**: 50 pastes created per second at peak; 5k reads per second, 90% of them for pastes read in the last few minutes, 1% for expired ones.
- **Size**: 10 KB on average, up to 10 MB. Five years add up to about 80 TB.
- **Latency**: p99 of a read under 100 ms and of a create under 300 ms, and a popular (`"Cached"`) paste under **30 ms** at p99.
- **Availability** of reads 99.9%; no paste lost once its id has been returned; survive the loss of any single machine.
- **Budget**: $6,000 a month, *egress included*: the twist of this problem.

`given.proschi` declares only the `user`, plus the traffic mix, the requirements and the tests. The statement also asks for the payload size (`~10KB`) on every step that carries text, so the simulation can count transfer time and egress.

The tests check four ideas:

1. **Paste text lives in object storage**: creating writes to storage before responding, and a `"Not cached"` read calls storage.
2. **Metadata lives in a database**: creating writes a database row before responding, and answers `201`.
3. **Popular pastes are served by the CDN**: the `"Cached"` scenario calls a CDN and never calls a service, a database or storage.
4. **Expiry is checked before the text is fetched**: reads call the database before storage, and the `"Expired"` scenario never touches storage and answers `404`.

## Back-of-the-envelope

```numbers
100 : 1 | reads for every write
≈ 80 TB | of text over five years
≈ 130 TB | egress a month
≈ $11,700 | that egress from your API
≈ $2,600 | the same bytes from a CDN
4,500 rps | reads the edge can answer
```

| Quantity | Arithmetic | Result |
|---|---|---|
| Read:write ratio | 5,000 ÷ 50 | 100 : 1 |
| Pastes per day | 50 × 86,400 s | 4.3 million |
| Pastes per year | 4.3 M × 365 | ≈ 1.6 billion |
| Text per year | 1.6 B × 10 KB | ≈ 16 TB |
| Text over 5 years | 16 TB × 5 | ≈ 80 TB |
| Metadata per year | 1.6 B × ~200 bytes | ≈ 320 GB |
| Read bandwidth to readers | 5,000 × 10 KB | 50 MB/s |
| Egress per month | 50 MB/s × 2,592,000 s | ≈ 130 TB |
| Egress cost from a CDN | 129,600 GB × $0.02 | ≈ $2,600 / month |
| Egress cost from your API | 129,600 GB × $0.09 | ≈ $11,700 / month |

**The text and the metadata are different problems.** 80 TB of text is too much for a database's rows, replicas and backups; 320 GB of small rows a year is easy. Split them.

**Egress dominates the bill.** *Egress*, data sent out of the cloud provider's network to readers, is billed per gigabyte.

```callout takeaway
130 TB a month from anything you run costs about $11,700, nearly twice the whole budget before a single server; from a CDN, about $2,600. The CDN isn't an optimisation here; it's the only way to fit the budget.
```

```quiz
egress-bill
```

**Most reads never need the origin.** 90% of 5k rps is 4,500 rps the edge can answer. The *origin* (your API and what's behind it) sees only the remaining 10%:

| Component | Load it sees | Capacity per replica (simulation default) |
|---|---|---|
| CDN (`[AWS CloudFront]`) | 5,000 reads + 50 writes | 200,000 rps |
| API (`[REST API]`) | 450 not cached + 50 expired + 50 creates | 2,000 rps |
| Metadata DB (`[PostgreSQL]`) | ~500 reads + 50 writes | 20,000 reads, 5,000 writes on the primary |
| Object storage (`[AWS S3]`) | 450 reads + 50 writes | 5,000 rps |

How this shows up in Proschi:

- **Transfer time.** A payload moves at the slower end's bandwidth: a client gets 10 MB/s in the model, so 10 KB costs the reader about 1 ms, and a 10 MB paste a full second.
- **Latency.** Idle latencies: about 5 ms for a CDN, 10 ms for a service, 5 ms for a database and 30 ms for object storage. A `"Cached"` read is one hop plus transfer, far below 30 ms at p99. A `"Not cached"` read goes CDN → API → database → storage in sequence, about 50 ms on average.
- **Egress.** The simulation charges payloads sent to a client to the node that sends them: $0.09/GB from anything you run, $0.02/GB from a CDN. Copies inside your system (storage to API, CDN filling from the origin) are free. Watch the *Egress/month* column in the Analysis tab.
- **Availability.** A read's availability is computed over its main scenario, the one with the largest share. Here that is `"Cached"`, so it mostly depends on the CDN, up 99.99% per replica.

```deepdive Why the slow path still passes 100 ms
An idle hop's p99 is about 2.8× its mean, so the `"Not cached"` path alone is well over 100 ms at p99. The design still passes the 100 ms read limit because p99 is computed over *all* reads. With 90% answered at the edge, the blended p99 sits near the origin path's p90, not its p99.
```

## Concepts

### Object storage for blobs, a database for metadata

**What it is.** Object storage (Amazon S3, Google Cloud Storage, Azure Blob) stores *objects*: a key and a bag of bytes, up to terabytes, that you `PUT`, `GET` and `DELETE` by key, and little else. A database stores rows you can index, filter and update.

**Why it works.** Object storage is cheap per gigabyte, extremely durable (several copies across facilities), and scales out behind one name, so you never shard it yourself. A database is great at small structured records and queries, but slow and expensive to back up, replicate and restore when rows carry megabytes. Text in S3 and a row like *(id, object key, size, created, expires)* in the database plays each to its strength.

**Trade-offs.** Two writes per create instead of one, so order them: body first, then the row. If the process dies in between, you get an orphaned object nobody can reach (harmless; a cleanup job sweeps it), not a row pointing at a missing body (a broken link). Object storage is also slower per request (tens of milliseconds) than a database read.

**When not to use it.** When the "blob" is tiny (a 200-byte tweet belongs in a row) or when you need to query inside it.

```proschi
title "Blob and metadata"

user  "User"        [Actor]
api   "Upload API"  [REST API]   x2
meta  "Files DB"    [PostgreSQL] x2
blobs "File Bodies" [AWS S3]     x2

user -> api
api  -> meta  : SQL
api  -> blobs : PUT / GET

usecase "Upload" {
  user   -> api   : ~2MB POST /files
  api    -> blobs : ~2MB PUT files/f1
  blobs --> api   : 200
  api    -> meta  : INSERT file f1
  meta  --> api   : ok
  api   --> user  : 201
}
```

```quiz
metadata-vs-content
```

### Pull CDNs and cache lifetimes

**What it is.** A CDN is a network of caching servers (*edges*) close to users. In a *pull* CDN, the edge forwards a miss to your *origin*, caches the answer as long as the origin's `Cache-Control: max-age` allows, and answers every following request for that URL itself.

**Why it works here.** Paste reads come in bursts on one URL (a link in a busy chat is opened by everyone within minutes), so one origin fetch serves the whole burst. The edge is close to the reader, so it answers in a few milliseconds, and it never touches your servers: that is why the test forbids any service, database or storage call in `"Cached"`.

**Trade-offs.** The edge serves whatever it cached until the lifetime runs out; deleting or expiring a paste doesn't reach copies already there unless you purge them. Short lifetimes keep that window small but send more misses to the origin.

**When not to use it.** Personalised or private responses (unless you are careful with cache keys and auth), and content that is read once.

**Egress, the hidden reason.** Data leaving the provider's network is billed per gigabyte (traffic between your own services is cheap or free), and at high read rates it can cost more than all your servers, as here. CDNs charge far less per GB and absorb repeated reads: cheaper as well as faster. For tiny responses egress hardly matters, so check the bytes first.

```proschi
title "Pull CDN"

reader "Reader" [Actor]
cdn    "CDN"    [AWS CloudFront] x2
origin "Origin" [REST API]       x2

reader -> cdn
cdn    -> origin : HTTPS

usecase "Get page" {
  reader -> cdn : ~50KB GET /page
  alt "Edge hit" {
    cdn --> reader : 200
  } alt "Edge miss" {
    cdn     -> origin : ~50KB GET /page
    origin --> cdn    : 200 max-age=300
    cdn    --> reader : 200
  }
}
```

```quiz
cdn-cache-control
```

### Expiry: check small before fetching big

**What it is.** A job could delete expired bodies, but a read can't wait for it. So the read path checks the row's `expiresAt` first and answers `404` for an expired paste without fetching the body.

**Why it works.** The row is tiny and indexed; the body may be 10 MB in slower storage. Checking the cheap thing first saves a storage read per expired request, and deletion can run lazily (an index on `expiresAt` makes it a range scan), or through object storage lifecycle rules.

```callout pitfall The CDN wrinkle
If the origin tells the edge to cache a paste for 5 minutes, an expired paste can stay visible for up to 5 minutes past its expiry. An acceptable, explicit bound here; for a revoked secret you'd purge the edge or not cache at all.
```

**When not to bother.** If expired items may be served for a while (a cache of public data), a TTL on the store itself is simpler than an explicit check.

````deepdive The pattern in Proschi
```proschi
title "Check before fetch"

user  "User"      [Actor]
api   "Share API" [REST API]   x2
meta  "Shares DB" [PostgreSQL] x2
blobs "Bodies"    [AWS S3]     x2

user -> api
api  -> meta  : SQL
api  -> blobs : GET

usecase "Open share" {
  user  -> api  : GET /s/9f
  api   -> meta : SELECT share 9f
  alt "Live" {
    meta  --> api   : expires next week
    api    -> blobs : ~1MB GET shares/9f
    blobs --> api   : body
    api   --> user  : 200
  } alt "Gone" {
    meta --> api  : expired
    api  --> user : 404
  }
}
```
````

## Designing it step by step

### Step 1: Scope

Clarify before drawing:

- Text only, or files too? (Text, up to 10 MB.)
- Can pastes be edited or deleted? (Not here, which keeps caching simple.)
- Private pastes, syntax highlighting, analytics? Out of scope: say so.
- Read/write rates and sizes? Turn them into the table above, and mention the egress number early: it surprises interviewers in a good way.

### Step 2: High-level design

The naive version is user → API → database, with the text in a column. It strains: 80 TB in the database, megabyte rows in every backup and replica, and every read pays the API's egress price.

Split storage first: text into object storage, one row per paste in a database. Then put a CDN in front of everything as the single entry point: creates pass through to the API; reads try the edge first.

### Step 3: Deep dive

**The create path.** Body to storage first, then the row, so a failure leaves nothing broken; only then answer `201`. Both stores are durable, so the returned id can't disappear.

**The read path.** Write three scenarios:

- `"Cached"`: the CDN answers. Nothing else is called.
- `"Not cached"`: CDN → API → database (is it expired? where's the body?) → storage → back, with a `Cache-Control` lifetime on the answer so the edge keeps it.
- `"Expired"`: CDN → API → database, which says expired, and the API answers `404` without touching storage.

Put `~10KB` on every step that carries the text: the user's request in a create, the storage reads and writes, and the reader's request in a read.

**Which database?** The metadata is small, structured and queried by id and by expiry. A relational database fits (50 writes per second is nothing for one primary); a key-value store also works. What matters is that it's durable and replicated.

**Sizing.** Size the API and stores for the origin's tenth of the reads, well below 70% busy, each node surviving the loss of one replica. Then check the Analysis tab: `"Cached"` p99 under 30 ms, overall read p99 under 100 ms, and the total under $6,000 with egress counted.

**Alternatives worth naming.** A Redis cache behind the API, the classic read-heavy instinct, loses twice here: every cached read still crosses your edge and your API (too slow for 30 ms at p99), and the bytes leave your servers at the expensive egress rate.

### Step 4: Wrap up

Recap: "Bodies in object storage, metadata in a relational database, a CDN in front with a short cache lifetime; expiry is checked on the row before the body is fetched; the edge answers 90% of reads and makes egress affordable." Then name extensions: a cleanup job and lifecycle rules for expired objects, rate limiting creates, abuse scanning, and compressing text before storing it.

## Common mistakes

**Every read from object storage** (`wrong/every-read-from-object-storage`). The CDN is there, but every read goes through the API, the database and S3, so object storage carries the full read rate. Each read waits for three hops, including S3's ~30 ms, and the blended p99 jumps to roughly twice the limit. Caught by **p99 of Read paste < 100 ms**. It also fails the 30 ms `"Cached"` limit, the CDN test and `survive any node failure` (one S3 replica cannot take all 5k reads).

**A Redis cache instead of the CDN** (`wrong/redis-cache-instead-of-cdn`). A load balancer replaces the CDN and Redis sits behind the API. Popular reads still cross the load balancer and the API, so their p99 is more than twice the CDN's and misses 30 ms. Worse, the load balancer sends 130 TB a month to readers at the internet rate: egress alone blows the budget. Caught by **p99 of Read paste scenario Cached < 30 ms** and **Popular pastes are served by the CDN**; it fails the cost limit too.

**Text in the database.** Fine at small scale; then backups take days and replicas lag behind multi-megabyte writes. Caught by **Paste text lives in object storage**.

**Fetching the body before checking expiry.** You pay a storage read for every expired request and might even serve an expired paste. Caught by **Expiry is checked before the text is fetched**.

**Forgetting payload sizes.** Without `~10KB` the simulation sees no bytes, so no egress and no transfer time: the design looks cheaper and faster than it is. No test flags a missing size, so this one is on you; in an interview, it decides whether the design fits the budget.

**Long CDN lifetimes.** A one-day `max-age` means expired pastes stay readable for up to a day. Keep the lifetime short, or purge on expiry.

## In the interview

```callout interview Lead with two numbers
80 TB of text and 130 TB a month of egress shape everything: the first argues for object storage, the second for a CDN.
```

**How to present it.** Open with those two numbers, then draw create and read with the three read scenarios, saying what each one touches.

Common follow-ups:

- **"How do you generate the id?"** As for a URL shortener: a Base62 counter, or random. Random is better here: pastes may hold things people would rather not have enumerated.
- **"How do you delete expired pastes?"** Lazily on read (the `404` path), plus a background job scanning the `expiresAt` index and deleting rows and objects, or object lifecycle rules on storage.
- **"What if a paste must disappear immediately?"** Purge it from the CDN, or don't let the edge cache it (`Cache-Control: no-store`) and accept the origin load.
- **"What about 10 MB pastes?"** Upload straight to object storage with a pre-signed URL, bypassing your API, which only writes the row.
- **"Why not Redis?"** It speeds up the origin, but the request still crosses your stack and the bytes still leave at the expensive rate. The CDN removes both.
- **"How would you add view counts?"** CDN logs or an async event per origin read, aggregated off the read path.

## Further reading

- [System Design Primer: Design Pastebin.com (or Bit.ly)](https://github.com/donnemartin/system-design-primer/blob/master/solutions/system_design/pastebin/README.md): a full worked solution with usage estimates, an object store for the text, and a discussion of expiry.
- [System Design Primer: Content delivery network](https://github.com/donnemartin/system-design-primer#content-delivery-network): push vs pull CDNs and their disadvantages.
- [Amazon CloudFront: Manage how long content stays in the cache (expiration)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html): how `Cache-Control: max-age` and `s-maxage` decide what the edge keeps.
- *System Design Interview – An Insider's Guide*, Vol. 2 (Alex Xu, Sahn Lam), chapter "S3-like Object Storage": what happens inside the object store this design relies on.
- [How the simulation works](https://proschi.app/docs/model/): section 1.6 explains payload sizes, bandwidth and egress pricing as the simulation computes them.
- [awesome-scalability](https://github.com/binhnguyennus/awesome-scalability): a large index of engineering posts on caching, CDNs and storage at real companies.
