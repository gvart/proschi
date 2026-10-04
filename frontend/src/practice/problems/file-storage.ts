import type { Problem } from '../types';

export const fileStorage: Problem = {
  id: 'file-storage',
  title: 'File Storage',
  difficulty: 'medium',
  tags: ['storage', 'cdn', 'durability', 'async'],
  statement: `Design a small Dropbox: users upload files, list their folders and
download files again, from any device. Files are anything from a 10 KB note
to a 2 GB video, so their bytes must never stream through your own servers:
the API hands out **pre-signed URLs** and the client talks to object storage
directly.

## Functional requirements

- **List files**: a user opens a folder and gets its files' names, sizes and
  a signed download link for each.
- **Start upload**: a user asks to upload a file. The API records the file as
  pending in the metadata store and answers \`201\` with a pre-signed URL that
  allows one \`PUT\` to the bucket.
- **Upload**: the client \`PUT\`s the bytes to the pre-signed URL, straight
  into object storage. Once the object is stored, the file must be marked
  ready in the metadata store without the client's help (it may already be
  offline).
- **Download**: the client fetches a file through its signed download link.
  Name its two scenarios \`"CDN hit"\` (the file is cached at the edge) and
  \`"CDN miss"\` (the edge fetches it from the bucket).

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- Downloads: **20k rps**, 90% of them for files that were fetched recently.
- Folder listings: **3k rps**.
- Uploads: **500 rps** (each one a Start upload followed by an Upload).
- The bucket serves at most **10k requests per second**.

## Constraints

- p99 of every use case under **300 ms** (transfer time not included), of a
  download under **150 ms**.
- Every use case available **99.9%** of the time.
- An upload is acknowledged only once its bytes are stored durably; a
  pending file is recorded before its URL is handed out.
- Clients never reach the metadata store directly.
- Losing any single machine must not take the service down.
- At most **$3,000 / month**, the bucket included.

## What is given

\`problem.proschi\` declares the \`user\` and the bucket \`blobs\` (S3, two
partitions) and holds the traffic, requirements and tests. Add the API, the
metadata store, the CDN, how a stored object marks its file ready, and the
four use cases.`,
  given: `title "File Storage" "Stores users' files and serves them back, like a small Dropbox"

user  "User"           [Actor]
blobs "Object Storage" [AWS S3] x2 @storage "The bucket that holds every file's bytes; at most 10k requests per second"

traffic {
  "Download"     20k rps mix "CDN hit" 90%, "CDN miss" 10%
  "List files"   3k rps
  "Start upload" 500 rps
  "Upload"       500 rps
}

requirements {
  p99 < 300ms
  p99 "Download" < 150ms
  availability >= 99.9%
  durable "Start upload"
  durable "Upload"
  survive any node failure
  cost <= 3000 usd/month
}

test "File bytes never pass through your servers" {
  "Upload" calls blobs
  "Upload" never calls any edge
  no path from any service to blobs
  no path from any function to blobs
}

test "The API hands out pre-signed URLs for pending files" {
  "Start upload" writes any database before responding
  "Start upload" responds 201
  "Start upload" never calls blobs
}

test "Downloads are served by the CDN" {
  "Download" has scenario "CDN hit"
  "Download" has scenario "CDN miss"
  "Download" scenario "CDN hit" never calls blobs
  "Download" calls any edge before blobs
}

test "Metadata stays behind the API" {
  no path from user to any database
}
`,
  starter: `import "problem.proschi"

# Add the API, the metadata store, the CDN and the use cases
# "List files", "Start upload", "Upload" and "Download".
api "Files API" [REST API]

user -> api
api  -> blobs

usecase "Upload" {
  user  -> api   : PUT /files/report.pdf
  api   -> blobs : PutObject report.pdf
  blobs --> api  : 200
  api  --> user  : 200
}
`,
  solution: `import "problem.proschi"

lb       "Load Balancer"   [AWS Load Balancer] x2
api      "Files API"       [REST API]          x4 @files "Lists folders, records uploads and signs URLs"
meta     "Metadata DB"     [PostgreSQL]        x2 @files "Folders, files and their upload state"
cdn      "CDN"             [AWS CloudFront]    x2 @files "Caches file bytes at the edge; fetches misses from the bucket"
events   "Upload Events"   [AWS SQS]           x2 @files "ObjectCreated notifications from the bucket"
finisher "Upload Finisher" [AWS Lambda]        x2 @files "Marks a file ready once its object is stored"

user     -> lb
user     -> blobs    : PUT pre-signed
user     -> cdn      : GET signed
lb       -> api      : HTTPS
api      -> meta     : SQL
cdn      -> blobs    : origin fetch
blobs    -> events   : ObjectCreated
events   -> finisher : trigger
finisher -> meta     : SQL

entity File in meta "One file in a user's folder" {
  id        uuid   key
  ownerId   uuid   index
  folder    string index
  name      string
  size      int
  objectKey string unique
  status    string
  createdAt time
}

decision "Pre-signed URLs instead of proxying bytes" {
  because "A 2 GB upload through the API would hold a server for minutes; the bucket takes the bytes directly and the API only signs a URL, which needs no call"
  rejected "Upload through the API" "Every byte crosses the API twice and its replicas scale with bandwidth, not requests"
}
decision "Bucket events mark uploads ready" {
  because "The client may go offline right after its PUT; the bucket's ObjectCreated event reaches the finisher through a durable queue either way"
  rejected "Client calls a Complete endpoint" "A client that disappears leaves the file pending forever"
}
decision "Downloads through a CDN" because "90% of downloads repeat recent files; the edge serves them and keeps the bucket under its 10k rps limit"

usecase "List files" "Show the files in a folder with signed download links" {
  user  -> lb   : GET /folders/{id}/files
  lb    -> api  : GET /folders/{id}/files
  api   -> meta : SELECT files WHERE folder = ?
  meta --> api  : rows
  api  --> lb   : 200 {"files": [{"name": "report.pdf", "url": "https://cdn.example.com/f/9a1?sig=…"}]}
  lb   --> user : 200 {"files": [{"name": "report.pdf", "url": "https://cdn.example.com/f/9a1?sig=…"}]}
}

usecase "Start upload" "Record a pending file and hand out a pre-signed PUT URL" {
  user  -> lb   : POST /files json {"folder": "docs", "name": "report.pdf", "size": 52000}
  lb    -> api  : POST /files
  api   -> meta : INSERT File status=pending
  meta --> api  : ok
  api  --> lb   : 201 {"id": "9a1", "uploadUrl": "https://blobs.example.com/9a1?sig=…"}
  lb   --> user : 201 {"id": "9a1", "uploadUrl": "https://blobs.example.com/9a1?sig=…"}
}

usecase "Upload" "Put the bytes straight into the bucket" {
  user     -> blobs    : PUT /9a1?sig=…
  blobs   --> user     : 200
  blobs   ->> events   : ObjectCreated 9a1
  events  ->> finisher : ObjectCreated 9a1
  finisher -> meta     : UPDATE File status=ready
  meta    --> finisher : ok
}

usecase "Download" "Fetch a file through its signed link" {
  user -> cdn : GET /f/9a1?sig=…

  alt "CDN hit" when "the file was fetched recently" {
    cdn --> user : 200 bytes
  } alt "CDN miss" when "the edge does not have the file" {
    cdn    -> blobs : GetObject 9a1
    blobs --> cdn   : 200 bytes
    cdn   --> user  : 200 bytes
  }
}
`,
  hints: [
    'Your API should never touch the bytes. What can it hand the client instead, so that the client writes to the bucket itself?',
    'The upload is acknowledged by the bucket, not by your API. The bucket can publish an event when an object arrives: let a worker behind a queue mark the file ready.',
    'The bucket takes 10k rps and downloads alone are 20k rps. Put a CDN in front of it so only the misses reach it.',
    'Start upload must write the pending file to a durable store before answering 201; size the API for 3.5k rps and give every component two replicas.',
  ],
};
