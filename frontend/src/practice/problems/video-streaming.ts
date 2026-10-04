import type { Problem } from '../types';

export const videoStreaming: Problem = {
  id: 'video-streaming',
  title: 'Video Upload and Streaming',
  difficulty: 'hard',
  tags: ['cdn', 'object-storage', 'queues', 'async', 'bandwidth', 'cost'],
  statement: `Design a video platform: creators upload videos, and viewers watch them.
Every upload has to be transcoded into several resolutions (HLS segments)
before anyone can watch it, which takes about a minute of machine time per
video. Watching is by far the bigger job, and the bytes are what cost money:
about 40,000 viewers are watching at any moment, each fetching a **4 MB**
segment every four seconds.

## Functional requirements

- **Upload video**: a creator registers a video with its title and gets
  \`201\` with an upload URL; the video is recorded as *uploading*. The
  creator then sends the file (about **2 GB**) **straight to object
  storage** with that URL; the bytes never pass through your servers. When
  the file has landed, storage announces it so that it gets transcoded.
- **Transcode video**: the queue hands a transcoder one uploaded original.
  It reads the original, writes the HLS renditions back to storage and then
  marks the video *ready*.
- **Open video**: a viewer opens a video page and gets its title, status and
  the manifest URL. Name its scenarios \`"Cache hit"\` and \`"Cache miss"\`.
- **Stream video**: the player fetches the next video segment. Name its
  scenarios \`"Edge hit"\` (the segment is cached near the viewer) and
  \`"Edge miss"\` (it has to be fetched from where the renditions are
  stored).

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- **2 uploads per second** (about 170k videos a day), about **2 GB** each.
- **5k rps** of video page opens, 95% of them for popular videos.
- **10k rps** of segment requests, about **4 MB** each; 99% are for segments
  already at the edge.

Write the payload sizes on the steps that carry them: \`~2GB\` on the
creator's upload and \`~4MB\` on every segment download (\`~4MB GET
/hls/…\`). They add transfer time, and bytes served from object storage or a
CDN cost **egress**: $0.09 per GB from storage, $0.02 per GB from a CDN.
Copies inside the region (the transcoder reading the original, a CDN filling
from storage aside) are left without a size here.

## Constraints

- Transcoding never runs while the creator waits, and it is fed by a queue:
  p99 of the upload request under **1 s**.
- The video is recorded durably before the creator gets the upload URL.
- No server of yours touches the video bytes on the way in: the creator
  uploads to storage directly.
- p99 of opening a video under **150 ms**; a 4-second segment must arrive in
  well under its own length: p99 under **2 s**, the transfer included.
- Streaming available **99.99%** of the time.
- Losing any single machine must not stop uploads or playback.
- At most **$2.5M / month**, bandwidth and the transcoding fleet included.
  Bandwidth dominates: compare serving 10k segments a second from storage and
  from a CDN.

## What is given

\`problem.proschi\` declares the \`creator\`, the \`viewer\` and the
\`transcoder\` fleet (10 workers; each takes a job about every two seconds,
and a job takes 60 s from start to finish), and holds the traffic,
requirements and tests. Add where originals, renditions and metadata live,
how transcoding jobs reach the fleet, how segments reach viewers, the
connections and the four use cases.`,
  given: `title "Video Platform" "Creators upload videos; viewers stream them from the edge"

creator    "Creator"    [Actor]
viewer     "Viewer"     [Actor]
transcoder "Transcoder" [AWS ECS] x10 @media "Turns an original into HLS renditions; a minute per video"

capacity {
  transcoder 0.5 rps latency 60s cost 200 usd/month
}

traffic {
  "Upload video"    2 rps
  "Transcode video" 2 rps
  "Open video"      5k rps  mix "Cache hit" 95%, "Cache miss" 5%
  "Stream video"    10k rps mix "Edge hit" 99%, "Edge miss" 1%
}

requirements {
  p99 "Upload video" < 1s
  p99 "Open video" < 150ms
  p99 "Stream video" < 2s
  availability "Stream video" >= 99.99%
  durable "Upload video"
  survive any node failure
  cost <= 2500000 usd/month
}

test "The file goes straight to object storage, never through a server" {
  in "Upload video" creator calls any storage
  in "Upload video" any service or any function never calls any storage
  "Upload video" writes any database before responding
  "Upload video" responds 201
}

test "Transcoding is queued, never in the request path" {
  "Upload video" never waits for transcoder
  "Upload video" calls any queue
  "Transcode video" starts at any queue
  "Transcode video" calls transcoder
  "Transcode video" calls any database after any storage
}

test "Segments are served by a CDN, with storage as its origin" {
  "Stream video" calls any cdn before any storage
  "Stream video" scenario "Edge hit" never calls any storage
  "Stream video" never calls any service
  no path from viewer to any storage
}

test "Video pages read metadata from a cache" {
  "Open video" calls any cache before any database
  "Open video" scenario "Cache hit" never calls any database
}
`,
  starter: `import "problem.proschi"

# Add storage, metadata, the transcoding queue, the CDN and the use cases
# "Upload video", "Transcode video", "Open video" and "Stream video".
api "Video API" [REST API]

creator -> api
api     -> transcoder

usecase "Upload video" {
  creator     -> api        : ~2GB POST /videos json {"title": "My trip"}
  api         -> transcoder : transcode
  transcoder --> api        : renditions
  api        --> creator    : 201 {"videoId": "v-9"}
}
`,
  solution: `import "problem.proschi"

lb     "Load Balancer"  [AWS Load Balancer] x2 @platform
api    "Video API"      [REST API]          x6 @media "Registers uploads, serves video pages"
cache  "Metadata Cache" [Redis]             x2 @media "Video metadata of popular videos"
db     "Videos DB"      [PostgreSQL]        x2 @media "Title, owner, status and manifest of every video"
jobs   "Transcode Jobs" [AWS SQS]           x2 @media "One message per uploaded original"
bucket "Video Storage"  [AWS S3]            x2 @media "Originals and HLS renditions"
cdn    "CDN"            [AWS CloudFront]    x2 @media "Caches segments near viewers; the bucket is its origin"

creator    -> lb
creator    -> bucket     : presigned PUT
viewer     -> lb
viewer     -> cdn
lb         -> api        : HTTPS
api        -> db         : SQL
api        -> cache      : GET / SET
bucket     -> jobs       : ObjectCreated
jobs       -> transcoder : deliver
transcoder -> bucket     : GET original, PUT renditions
transcoder -> db         : mark ready
cdn        -> bucket     : origin fetch

entity Video in db "One uploaded video" {
  videoId     uuid   key
  ownerId     string index
  title       string
  status      string
  manifestUrl string optional
  createdAt   time   index
}

entity Original in bucket "The file as uploaded" {
  key  string key
  size int
}

entity Segment in bucket "A few seconds of one rendition, immutable" {
  key        string key
  resolution string
  duration   int
}

decision "Upload straight to S3 with a presigned URL" {
  because "A 2 GB file takes minutes over the creator's connection; the API only records the video and signs a URL, so its request stays fast and no server copies the bytes"
  rejected "Upload through the API" "Every byte crosses the load balancer and the API, the upload request lasts minutes, and API replicas sit busy copying files"
}
decision "Transcode asynchronously through a queue fed by storage events" {
  because "The original exists only once the creator's PUT completes; S3 announces it on the queue, the fleet works at its own pace and the queue absorbs upload spikes"
  rejected "Transcode in the upload request" "A minute-long request ties up the API and times out; a burst of uploads would need a fleet sized for the peak"
  rejected "The API calls the transcoder directly" "Nothing keeps the job when every transcoder is busy or one crashes"
}
decision "Serve segments from a CDN with S3 as origin" {
  because "About 100 PB a month leave for viewers; from the CDN that is about $2.1M at $0.02/GB, from S3 about $9.3M at $0.09/GB. Segments are immutable, so 99% are served at the edge and S3 sees only the misses"
  rejected "Viewers read S3 directly" "Same latency, but four and a half times the egress bill, and four storage replicas just for the request rate"
  rejected "Serve segments through the API or a load balancer" "The bytes still leave S3 at storage prices, and servers copy every segment"
}
decision "Metadata in PostgreSQL, cached in Redis" because "Video pages are thousands of times more frequent than uploads and mostly for popular videos; the cache keeps page loads fast and the database small"

usecase "Upload video" "A creator registers a video and uploads the file straight to storage" {
  creator -> lb      : POST /videos json {"title": "My trip", "size": 2000000000}
  lb      -> api     : POST /videos
  api     -> db      : INSERT video v-9 status uploading
  db     --> api     : ok
  api    --> lb      : 201 {"videoId": "v-9", "uploadUrl": "https://bucket.s3.amazonaws.com/originals/v-9.mp4?X-Amz-Signature=…"}
  lb     --> creator : 201 {"videoId": "v-9", "uploadUrl": "https://bucket.s3.amazonaws.com/originals/v-9.mp4?X-Amz-Signature=…"}
  creator -> bucket  : ~2GB PUT /originals/v-9.mp4
  bucket ->> jobs    : ObjectCreated {"key": "originals/v-9.mp4"}
  bucket --> creator : 200
}

usecase "Transcode video" "The queue hands a transcoder one original; the video is ready once its renditions are stored" {
  jobs        -> transcoder : ObjectCreated {"key": "originals/v-9.mp4"}
  transcoder  -> bucket     : GET /originals/v-9.mp4
  bucket     --> transcoder : original
  transcoder  -> bucket     : PUT /hls/v-9/1080p/*.ts
  bucket     --> transcoder : 200
  transcoder  -> db         : UPDATE video v-9 status ready
  db         --> transcoder : ok
  transcoder --> jobs       : ack
}

usecase "Open video" "A viewer opens a video page" {
  viewer -> lb    : GET /videos/v-9
  lb     -> api   : GET /videos/v-9
  api    -> cache : GET video:v-9

  alt "Cache hit" when "the video is popular" {
    cache --> api : metadata
  } alt "Cache miss" when "the video was not opened recently" {
    cache --> api   : nil
    api    -> db    : SELECT video v-9
    db    --> api   : 1 row
    api   ->> cache : SET video:v-9 EX 300
  }
  api --> lb     : 200 {"title": "My trip", "manifest": "https://cdn.example.com/hls/v-9/master.m3u8"}
  lb  --> viewer : 200 {"title": "My trip", "manifest": "https://cdn.example.com/hls/v-9/master.m3u8"}
}

usecase "Stream video" "The player fetches the next segment" {
  viewer -> cdn : ~4MB GET /hls/v-9/1080p/00042.ts

  alt "Edge hit" when "the segment is cached at the edge" {
    cdn --> viewer : 200 video/MP2T
  } alt "Edge miss" when "first request for the segment at this edge" {
    cdn     -> bucket : ~4MB GET /hls/v-9/1080p/00042.ts
    bucket --> cdn    : 200
    cdn    --> viewer : 200 video/MP2T
  }
}
`,
  hints: [
    'A minute of transcoding cannot happen while the creator waits. What can hold the work until a transcoder is free, and who knows when the original has actually landed?',
    'A 2 GB file over a 10 MB/s connection takes minutes. Let the API only record the video and hand out a presigned URL; the creator PUTs the file to object storage after the API has answered, and storage announces the new object on a queue (bucket ->> jobs). "Transcode video" starts at that queue.',
    'Put the sizes on the steps (~2GB on the upload, ~4MB on segment downloads) and look at the cost: 10k segments a second is about 100 PB a month. At $0.09/GB from storage that blows the budget; at $0.02/GB from a CDN it fits.',
    'Segments never change once written, so a CDN in front of the bucket serves 99% of them; the bucket is only the origin for misses. A load balancer in front of storage does not help: the bytes still leave storage.',
  ],
};
