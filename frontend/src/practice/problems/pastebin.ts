import type { Problem } from '../types';

export const pastebin: Problem = {
  id: 'pastebin',
  title: 'Pastebin',
  difficulty: 'easy',
  tags: ['object-storage', 'cdn', 'read-heavy'],
  statement: `Design a service where people paste a block of text (a log, a stack
trace, a config file), get a short link back and share it. Anyone with the
link can read the paste until it expires.

## Functional requirements

- **Create paste**: a user posts the text and an optional expiry (one hour
  to one year) and gets a short id back (\`201\`).
- **Read paste**: anyone opens \`/<id>\` and gets the text. Name its three
  scenarios:
  - \`"Cached"\`: the paste was read recently and is served from a cache or
    the CDN.
  - \`"Not cached"\`: the paste has to be looked up and fetched.
  - \`"Expired"\`: the paste exists but has expired; the reader gets \`404\`
    and its text is never fetched.

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- **50 pastes per second** are created, at peak.
- Reads: **5k rps**, 90% of them for pastes that were read in the last few
  minutes (a link shared in a chat gets opened by everybody at once); 1% are
  for expired pastes.
- A paste is 10 KB on average and up to **10 MB**. Five years of pastes add
  up to about 80 TB.

## Constraints

- p99 of a read under **200 ms**, of creating a paste under **300 ms**.
- Reads available **99.9%** of the time.
- A paste is never lost once its id was returned.
- Losing any single machine must not take the service down.
- At most **$2,000 / month**.

## What is given

\`problem.proschi\` declares the \`user\` and holds the traffic, requirements
and tests. Add the components, the connections and the two use cases.`,
  given: `title "Pastebin" "Stores text pastes and serves them to anyone with the link"

user "User" [Actor]

traffic {
  "Read paste"   5k rps mix "Cached" 90%, "Not cached" 9%, "Expired" 1%
  "Create paste" 50 rps
}

requirements {
  p99 "Read paste" < 200ms
  p99 "Create paste" < 300ms
  availability "Read paste" >= 99.9%
  durable "Create paste"
  survive any node failure
  cost <= 2000 usd/month
}

test "Paste text lives in object storage" {
  "Create paste" writes any storage before responding
  "Read paste" scenario "Not cached" calls any storage
}

test "Metadata lives in a database" {
  "Create paste" writes any database before responding
  "Create paste" responds 201
}

test "Popular pastes never reach the stores" {
  "Read paste" scenario "Cached" never calls any database
  "Read paste" scenario "Cached" never calls any storage
}

test "Expiry is checked before the text is fetched" {
  "Read paste" calls any database before any storage
  "Read paste" scenario "Expired" never calls any storage
  "Read paste" scenario "Expired" responds 404
}
`,
  starter: `import "problem.proschi"

# Add the components, connections and the use cases "Create paste" and "Read paste".
api "Paste API" [REST API]

user -> api

usecase "Create paste" {
  user -> api : POST /pastes json {"text": "panic: runtime error", "expiresIn": "1d"}
  api --> user : 201 {"id": "k7Qz2"}
}
`,
  solution: `import "problem.proschi"

cdn    "CDN"          [AWS CloudFront] x2 @pastes "Caches pastes at the edge for a few minutes"
api    "Paste API"    [REST API]       x2 @pastes "Creates pastes and serves the ones the CDN misses"
meta   "Paste DB"     [PostgreSQL]     x2 @pastes "One row per paste: id, size, expiry, where its text is"
bodies "Paste Bodies" [AWS S3]         x2 @pastes "The text of every paste, one object per paste"

user -> cdn
cdn  -> api    : HTTPS (origin)
api  -> meta   : read / write
api  -> bodies : GET / PUT object

entity Paste in meta "What the service knows about a paste" {
  id        string key
  bodyKey   string
  sizeBytes int
  createdAt time
  expiresAt time   index
}

entity PasteBody in bodies "The text, stored as is" {
  key  string key
  text string
}

decision "Text in object storage, metadata in PostgreSQL" {
  because "80 TB of blobs up to 10 MB are cheap and durable in S3; the database only holds small rows it can index by expiry"
  rejected "Text in the database" "Bloats every row, backups and replicas with megabytes nobody queries"
}
decision "Serve reads through a CDN" {
  because "A shared link is opened by many readers within minutes; the edge answers 90% of reads without touching the API"
  rejected "Redis in front of the database" "Still needs enough API replicas to take all 5k rps"
}
decision "Short CDN lifetime" because "Caching for 5 minutes keeps an expired paste visible for at most 5 minutes past its expiry"

usecase "Create paste" "Store a paste and return its id" {
  user    -> cdn    : POST /pastes json {"text": "panic: runtime error", "expiresIn": "1d"}
  cdn     -> api    : POST /pastes
  api     -> bodies : PUT pastes/k7Qz2
  bodies --> api    : 200
  api     -> meta   : INSERT Paste k7Qz2
  meta   --> api    : ok
  api    --> cdn    : 201 {"id": "k7Qz2"}
  cdn    --> user   : 201 {"id": "k7Qz2"}
}

usecase "Read paste" "Show the text of a paste" {
  user -> cdn : GET /k7Qz2

  alt "Cached" when "the paste was read in the last few minutes" {
    cdn --> user : 200 text
  } alt "Not cached" when "nobody read it lately" {
    cdn     -> api    : GET /k7Qz2
    api     -> meta   : SELECT Paste k7Qz2
    meta   --> api    : expires tomorrow
    api     -> bodies : GET pastes/k7Qz2
    bodies --> api    : text
    api    --> cdn    : 200 text (Cache-Control: max-age=300)
    cdn    --> user   : 200 text
  } alt "Expired" when "the paste is past its expiry" {
    cdn   -> api  : GET /k7Qz2
    api   -> meta : SELECT Paste k7Qz2
    meta --> api  : expired yesterday
    api  --> cdn  : 404
    cdn  --> user : 404 {"error": "expired"}
  }
}
`,
  hints: [
    'Pastes can be 10 MB and add up to 80 TB. Which kind of store is built for large blobs, and what is left for the database?',
    'Reads come in bursts for the same link. What can answer them before they reach your servers at all?',
    'Look up the paste row first: it tells you whether the paste expired, so an expired read never fetches the text.',
    'The "Not cached" path sets p99 (9% of reads): it pays the CDN, the API, the database and object storage (~30 ms) one after the other.',
  ],
};
