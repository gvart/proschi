import type { Problem } from '../types';

export const fileStorage: Problem = {
  id: 'file-storage',
  title: 'File Storage',
  difficulty: 'medium',
  tags: ['storage', 'cdn', 'egress', 'async'],
  statement: `Design a small Dropbox: users upload files, list their folders and
download files again, from any device. Files are anything from a 10 KB note
to a 2 GB video, so their bytes must never stream through your own servers:
the API hands out **pre-signed URLs** and the client talks to object storage
(for uploads) and to a CDN (for downloads) directly.

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
- **Download**: the client fetches a file through its signed download link,
  which points at a CDN. Name its two scenarios \`"CDN hit"\` (the file is
  cached at the edge) and \`"CDN miss"\` (the CDN fetches it from the bucket).

Use these use case and scenario names exactly: the traffic, requirements and
tests in \`problem.proschi\` refer to them.

## Scale

- Downloads: **500 rps**, 90% of them for files that were fetched recently.
- Folder listings: **2k rps**.
- Uploads: **200 rps** (each one a Start upload followed by an Upload).
- The average file is **1 MB**: write it on the steps that carry file bytes
  (\`user -> blobs : ~1MB PUT …\`, \`user -> cdn : ~1MB GET …\`, the CDN's
  fetch from the bucket), so transfer time and egress are counted.
- Data leaving the bucket costs **$0.09 per GB**, data leaving the CDN
  **$0.02 per GB**; a user's connection moves about 10 MB/s.

## Constraints

- p99 of a folder listing and of a start upload under **200 ms**; of an
  upload under **450 ms** and of a download under **500 ms**, transfer time
  included.
- Every use case available **99.9%** of the time.
- An upload is acknowledged only once its bytes are stored durably; a
  pending file is recorded before its URL is handed out.
- Clients never reach the metadata store directly.
- Losing any single machine must not take the service down.
- At most **$45,000 / month**, egress included: about 1.3 PB leaves the
  system every month, so where it leaves from decides the bill.

## What is given

\`problem.proschi\` declares the \`user\` and the bucket \`blobs\` (S3, two
partitions) and holds the traffic, requirements and tests. Add the API, the
metadata store, the CDN, how a stored object marks its file ready, and the
four use cases.`,
  given: `title "File Storage" "Stores users' files and serves them back, like a small Dropbox"

user  "User"           [Actor]
blobs "Object Storage" [AWS S3] x2 @storage "The bucket that holds every file's bytes"

traffic {
  "Download"     500 rps mix "CDN hit" 90%, "CDN miss" 10%
  "List files"   2k rps
  "Start upload" 200 rps
  "Upload"       200 rps
}

requirements {
  p99 "List files" < 200ms
  p99 "Start upload" < 200ms
  p99 "Upload" < 450ms
  p99 "Download" < 500ms
  availability >= 99.9%
  durable "Start upload"
  durable "Upload"
  survive any node failure
  cost <= 45000 usd/month
}

test "File bytes never pass through your servers" {
  in "Upload" user calls blobs
  in "Upload" any service or any function never calls blobs
  in "Download" any service or any function never calls blobs
  "Upload" never calls any edge
}

test "The API hands out pre-signed URLs for pending files" {
  "Start upload" writes any database before responding
  "Start upload" responds 201
  "Start upload" never calls blobs
}

test "Uploads are finished without the client" {
  "Upload" starts at user
  in "Upload" user never calls any edge or any service or any function
  "Upload" calls any database after blobs
}

test "Downloads are served by the CDN" {
  "Download" has scenario "CDN hit"
  "Download" has scenario "CDN miss"
  in "Download" user calls any cdn
  in "Download" user never calls blobs
  "Download" scenario "CDN hit" never calls blobs
  "Download" calls any cdn before blobs
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
  user  -> api   : ~1MB PUT /files/report.pdf
  api   -> blobs : ~1MB PUT /report.pdf
  blobs --> api  : 200
  api  --> user  : 200
}
`,
  solution: `import "problem.proschi"

lb       "Load Balancer"   [AWS Load Balancer] x2
api      "Files API"       [REST API]          x3 @files "Lists folders, records uploads and signs URLs"
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
  rejected "Upload through the API" "Every byte crosses the load balancer and the API on its way to the bucket: more hops, more transfer time, and API replicas that scale with bandwidth"
}
decision "Bucket events mark uploads ready" {
  because "The client may go offline right after its PUT; the bucket's ObjectCreated event reaches the finisher through a durable queue either way"
  rejected "Client calls a Complete endpoint" "A client that disappears leaves the file pending forever"
}
decision "Downloads through a CDN" {
  because "About 1.3 PB a month is downloaded: at $0.02/GB from the CDN instead of $0.09/GB from the bucket, the edge saves over $75k a month, and 90% of downloads never reach the bucket"
  rejected "Signed bucket URLs for downloads" "Every byte leaves the bucket at $0.09/GB: about $117k a month in egress alone"
}

usecase "List files" "Show the files in a folder with signed download links" {
  user  -> lb   : GET /folders/{id}/files
  lb    -> api  : GET /folders/{id}/files
  api   -> meta : SELECT files WHERE folder = ?
  meta --> api  : rows
  api  --> lb   : 200 {"files": [{"name": "report.pdf", "url": "https://cdn.example.com/f/9a1?sig=…"}]}
  lb   --> user : 200 {"files": [{"name": "report.pdf", "url": "https://cdn.example.com/f/9a1?sig=…"}]}
}

usecase "Start upload" "Record a pending file and hand out a pre-signed PUT URL" {
  user  -> lb   : POST /files json {"folder": "docs", "name": "report.pdf", "size": 1048576}
  lb    -> api  : POST /files
  api   -> meta : INSERT File status=pending
  meta --> api  : ok
  api  --> lb   : 201 {"id": "9a1", "uploadUrl": "https://blobs.example.com/9a1?sig=…"}
  lb   --> user : 201 {"id": "9a1", "uploadUrl": "https://blobs.example.com/9a1?sig=…"}
}

usecase "Upload" "Put the bytes straight into the bucket" {
  user     -> blobs    : ~1MB PUT /9a1?sig=…
  blobs   --> user     : 200
  blobs   ->> events   : ObjectCreated 9a1
  events  ->> finisher : ObjectCreated 9a1
  finisher -> meta     : UPDATE File status=ready
  meta    --> finisher : ok
}

usecase "Download" "Fetch a file through its signed link" {
  user -> cdn : ~1MB GET /f/9a1?sig=…

  alt "CDN hit" when "the file was fetched recently" {
    cdn --> user : 200 bytes
  } alt "CDN miss" when "the edge does not have the file" {
    cdn    -> blobs : ~1MB GetObject 9a1
    blobs --> cdn   : 200 bytes
    cdn   --> user  : 200 bytes
  }
}
`,
  hints: [
    'Your API should never touch the bytes. What can it hand the client instead, so that the client writes to the bucket itself?',
    'The upload is acknowledged by the bucket, not by your API. The bucket can publish an event when an object arrives: let a worker behind a queue mark the file ready.',
    'Downloads move about 1.3 PB a month. Leaving the bucket that costs $0.09/GB; leaving a CDN $0.02/GB. Point the download links at a CDN so only the misses reach the bucket.',
    'Mark the bytes with ~1MB on the upload PUT, the download GET and the CDN\'s fetch from the bucket; Start upload must write the pending file to a durable store before answering 201, and every component needs two replicas.',
  ],
};
