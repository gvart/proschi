import type { Problem } from '../types';

export const videoStreaming: Problem = {
  id: 'video-streaming',
  title: 'Video Upload and Streaming',
  difficulty: 'hard',
  tags: ['cdn', 'object-storage', 'queues', 'async', 'read-heavy', 'cost'],
  statement: `Design a video platform: creators upload videos, and viewers around the
world watch them. Every upload has to be transcoded into several resolutions
(HLS segments) before anyone can watch it, which takes about a minute of
machine time per video. Watching is by far the bigger job: millions of
viewers fetch video segments every few seconds, and nobody waits for a video
to start.

## Functional requirements

- **Upload video**: a creator uploads a video file with its title. The
  original is stored, the video is recorded as *processing*, and the creator
  gets \`202\` right away. Transcoding into renditions happens afterwards; when
  it is done the video is marked *ready*.
- **Open video**: a viewer opens a video page and gets its title, status and
  the manifest URL. Name its scenarios \`"Cache hit"\` and \`"Cache miss"\`.
- **Stream video**: the player fetches the manifest and video segments. Name
  its scenarios \`"Edge hit"\` (the segment is cached near the viewer) and
  \`"Edge miss"\` (it has to be fetched from where the renditions are
  stored).

Use these names exactly: the traffic, requirements and tests in
\`problem.proschi\` refer to them.

## Scale

- **2 uploads per second** (about 170k videos a day).
- **10k rps** of video page opens, 95% of them for popular videos.
- **200k rps** of segment requests; 99.5% are for segments already at the
  edge.

## Constraints

- Transcoding never runs while the creator waits: p99 of an upload under
  **1 s**.
- Uploads are stored durably before the creator hears back.
- p99 of a segment under **50 ms**, of opening a video under **150 ms**.
- Streaming available **99.99%** of the time.
- Losing any single machine must not stop uploads or playback.
- At most **$5,500 / month**, the transcoding fleet included.

## What is given

\`problem.proschi\` declares the \`creator\`, the \`viewer\` and the
\`transcoder\` fleet (10 workers; each takes a job about every two seconds,
and a job takes 60 s from start to finish), and holds the traffic,
requirements and tests. Add where originals, renditions and metadata live,
how transcoding jobs reach the fleet, how segments reach viewers, the
connections and the three use cases.`,
  given: `title "Video Platform" "Creators upload videos; viewers stream them from the edge"

creator    "Creator"     [Actor]
viewer     "Viewer"      [Actor]
transcoder "Transcoder"  [AWS ECS] x10 @media "Turns an original into HLS renditions; a minute per video"

capacity {
  transcoder 0.5 rps latency 60s cost 200 usd/month
}

traffic {
  "Upload video" 2 rps
  "Open video"   10k rps  mix "Cache hit" 95%, "Cache miss" 5%
  "Stream video" 200k rps mix "Edge hit" 99.5%, "Edge miss" 0.5%
}

requirements {
  p99 "Upload video" < 1s
  p99 "Open video" < 150ms
  p99 "Stream video" < 50ms
  availability "Stream video" >= 99.99%
  durable "Upload video"
  survive any node failure
  cost <= 5500 usd/month
}

test "Originals land in object storage before the upload is accepted" {
  "Upload video" writes any storage before responding
  "Upload video" calls any database
  "Upload video" responds 202
}

test "Transcoding is queued, never in the request path" {
  "Upload video" calls transcoder
  "Upload video" calls any queue before transcoder
}

test "Segments are served by the CDN, with storage as its origin" {
  "Stream video" calls any edge before any storage
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
# "Upload video", "Open video" and "Stream video".
api "Video API" [REST API]

creator -> api
api     -> transcoder

usecase "Upload video" {
  creator     -> api        : POST /videos json {"title": "My trip"}
  api         -> transcoder : transcode
  transcoder --> api        : renditions
  api        --> creator    : 201 {"videoId": "v-9"}
}
`,
  solution: `import "problem.proschi"

lb     "Load Balancer"  [AWS Load Balancer] x2 @platform
api    "Video API"      [REST API]          x8 @media "Uploads and video pages"
cache  "Metadata Cache" [Redis]             x2 @media "Video metadata of popular videos"
db     "Videos DB"      [PostgreSQL]        x2 @media "Title, owner, status and manifest of every video"
jobs   "Transcode Jobs" [AWS SQS]           x2 @media "One message per uploaded original"
bucket "Video Storage"  [AWS S3]            x2 @media "Originals and HLS renditions"
cdn    "CDN"            [AWS CloudFront]    x4 @media "Caches segments near viewers; the bucket is its origin"

creator    -> lb
viewer     -> lb
viewer     -> cdn
lb         -> api        : HTTPS
api        -> bucket     : PUT original
api        -> db         : SQL
api        -> cache      : GET / SET
api        -> jobs       : enqueue
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

decision "Transcode asynchronously through a queue" {
  because "A video takes about a minute to transcode; the creator gets 202 at once, and the queue absorbs upload spikes while the fleet works at its own pace"
  rejected "Transcode in the upload request" "A minute-long request ties up the API and times out; a burst of uploads would need a fleet sized for the peak"
}
decision "Serve segments from a CDN with S3 as origin" {
  because "Segments are immutable, so they cache forever at the edge: 99.5% never leave it, playback starts within milliseconds and the origin sees 1k rps instead of 200k"
  rejected "Serve segments from the API" "100 API replicas just to copy bytes, and every segment pays a round trip to the region"
  rejected "Viewers read S3 directly" "About 40 storage replicas worth of requests, and 30 ms or more per segment far from the region"
}
decision "Metadata in PostgreSQL, cached in Redis" because "Video pages are 50 times more frequent than uploads and mostly for popular videos; the cache keeps page loads fast and the database small"
decision "Originals and renditions in object storage" because "Cheap, durable and built for large immutable files; the database holds only metadata and keys"

usecase "Upload video" "A creator uploads a video; it is transcoded later" {
  creator    -> lb         : POST /videos json {"title": "My trip", "file": "trip.mp4"}
  lb         -> api        : POST /videos
  api        -> bucket     : PUT /originals/v-9.mp4
  bucket    --> api        : 200
  api        -> db         : INSERT video v-9 status processing
  db        --> api        : ok
  api       ->> jobs       : TranscodeRequested {"videoId": "v-9"}
  api       --> lb         : 202 {"videoId": "v-9", "status": "processing"}
  lb        --> creator    : 202 {"videoId": "v-9", "status": "processing"}
  jobs       -> transcoder : TranscodeRequested
  transcoder -> bucket     : GET /originals/v-9.mp4
  transcoder -> bucket     : PUT /hls/v-9/1080p/*.ts
  transcoder -> db         : UPDATE video v-9 status ready
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
  viewer -> cdn : GET /hls/v-9/1080p/00042.ts

  alt "Edge hit" when "the segment is cached at the edge" {
    cdn --> viewer : 200 video/MP2T
  } alt "Edge miss" when "first request for the segment at this edge" {
    cdn     -> bucket : GET /hls/v-9/1080p/00042.ts
    bucket --> cdn    : 200
    cdn    --> viewer : 200 video/MP2T
  }
}
`,
  hints: [
    'A minute of transcoding cannot happen while the creator waits. What can hold the work until a transcoder is free?',
    'Store the original in object storage and the video\'s metadata in a database before answering 202; then hand the job to the fleet through a queue with ->>.',
    'Segments never change once written. Which component can keep them close to viewers so the storage bucket only sees the rare miss?',
    'Count the cost of serving 200k rps without a CDN: storage handles about 5k rps per replica, the API about 2k. An edge node handles 100k.',
  ],
};
