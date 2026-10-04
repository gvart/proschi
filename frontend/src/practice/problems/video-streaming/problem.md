---
title: Video Upload and Streaming
summary: Asynchronous transcoding and a CDN in front of storage.
difficulty: hard
tags: [cdn, object-storage, queues, async, bandwidth, cost]
hints:
  - A minute of transcoding cannot happen while the creator waits. What can hold the work until a transcoder is free, and who knows when the original has actually landed?
  - A 2 GB file over a 10 MB/s connection takes minutes. Let the API only record the video and hand out a presigned URL; the creator PUTs the file to object storage after the API has answered, and storage announces the new object on a queue (bucket ->> jobs). "Transcode video" starts at that queue.
  - "Put the sizes on the steps (~2GB on the upload, ~4MB on segment downloads) and look at the cost: 10k segments a second is about 100 PB a month. At $0.09/GB from storage that blows the budget; at $0.02/GB from a CDN it fits."
  - "Segments never change once written, so a CDN in front of the bucket serves 99% of them; the bucket is only the origin for misses. A load balancer in front of storage does not help: the bytes still leave storage."
---

Design a video platform: creators upload videos, and viewers watch them.
Every upload has to be transcoded into several resolutions (HLS segments)
before anyone can watch it, which takes about a minute of machine time per
video. Watching is by far the bigger job, and the bytes are what cost money:
about 40,000 viewers are watching at any moment, each fetching a **4 MB**
segment every four seconds.

## Functional requirements

- **Upload video**: a creator registers a video with its title and gets
  `201` with an upload URL; the video is recorded as *uploading*. The
  creator then sends the file (about **2 GB**) **straight to object
  storage** with that URL; the bytes never pass through your servers. When
  the file has landed, storage announces it so that it gets transcoded.
- **Transcode video**: the queue hands a transcoder one uploaded original.
  It reads the original, writes the HLS renditions back to storage and then
  marks the video *ready*.
- **Open video**: a viewer opens a video page and gets its title, status and
  the manifest URL. Name its scenarios `"Cache hit"` and `"Cache miss"`.
- **Stream video**: the player fetches the next video segment. Name its
  scenarios `"Edge hit"` (the segment is cached near the viewer) and
  `"Edge miss"` (it has to be fetched from where the renditions are
  stored).

Use these names exactly: the traffic, requirements and tests in
`problem.proschi` refer to them.

## Scale

- **2 uploads per second** (about 170k videos a day), about **2 GB** each.
- **5k rps** of video page opens, 95% of them for popular videos.
- **10k rps** of segment requests, about **4 MB** each; 99% are for segments
  already at the edge.

Write the payload sizes on the steps that carry them: `~2GB` on the
creator's upload and `~4MB` on every segment download (`~4MB GET
/hls/…`). They add transfer time, and bytes served from object storage or a
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

`problem.proschi` declares the `creator`, the `viewer` and the
`transcoder` fleet (10 workers; each takes a job about every two seconds,
and a job takes 60 s from start to finish), and holds the traffic,
requirements and tests. Add where originals, renditions and metadata live,
how transcoding jobs reach the fleet, how segments reach viewers, the
connections and the four use cases.
