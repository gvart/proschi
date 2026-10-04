---
title: File Storage
summary: "Pre-signed uploads: the API never touches the bytes."
difficulty: medium
tags: [storage, cdn, egress, async]
hints:
  - Your API should never touch the bytes. What can it hand the client instead, so that the client writes to the bucket itself?
  - "The upload is acknowledged by the bucket, not by your API. The bucket can publish an event when an object arrives: let a worker behind a queue mark the file ready."
  - Downloads move about 1.3 PB a month. Sent to users from the bucket (or from anything else you run) that costs $0.09/GB; from a CDN $0.02/GB. Point the download links at a CDN so only the misses reach the bucket.
  - Mark the bytes with ~1MB on the upload PUT, the download GET and the CDN's fetch from the bucket; Start upload must write the pending file to a durable store before answering 201, and every component needs two replicas.
---

Design a small Dropbox: users upload files, list their folders and
download files again, from any device. Files are anything from a 10 KB note
to a 2 GB video, so their bytes must never stream through your own servers:
the API hands out **pre-signed URLs** and the client talks to object storage
(for uploads) and to a CDN (for downloads) directly.

## Functional requirements

- **List files**: a user opens a folder and gets its files' names, sizes and
  a signed download link for each.
- **Start upload**: a user asks to upload a file. The API records the file as
  pending in the metadata store and answers `201` with a pre-signed URL that
  allows one `PUT` to the bucket.
- **Upload**: the client `PUT`s the bytes to the pre-signed URL, straight
  into object storage. Once the object is stored, the file must be marked
  ready in the metadata store without the client's help (it may already be
  offline).
- **Download**: the client fetches a file through its signed download link,
  which points at a CDN. Name its two scenarios `"CDN hit"` (the file is
  cached at the edge) and `"CDN miss"` (the CDN fetches it from the bucket).

Use these use case and scenario names exactly: the traffic, requirements and
tests in `problem.proschi` refer to them.

## Scale

- Downloads: **500 rps**, 90% of them for files that were fetched recently.
- Folder listings: **2k rps**.
- Uploads: **200 rps** (each one a Start upload followed by an Upload).
- The average file is **1 MB**: write it on the steps that carry file bytes
  (`user -> blobs : ~1MB PUT …`, `user -> cdn : ~1MB GET …`, the CDN's
  fetch from the bucket), so transfer time and egress are counted.
- Data sent to users costs **$0.09 per GB** from the bucket or any other
  component you run, **$0.02 per GB** from the CDN; copies inside the
  system (the CDN filling from the bucket) are free. A user's connection
  moves about 10 MB/s.

## Constraints

- p99 of a folder listing and of a start upload under **200 ms**; of an
  upload under **220 ms** and of a download under **200 ms**, transfer time
  included.
- Every use case available **99.9%** of the time.
- An upload is acknowledged only once its bytes are stored durably; a
  pending file is recorded before its URL is handed out.
- Clients never reach the metadata store directly.
- Losing any single machine must not take the service down.
- At most **$45,000 / month**, egress included: about 1.3 PB leaves the
  system every month, so where it leaves from decides the bill.

## What is given

`problem.proschi` declares the `user` and the bucket `blobs` (S3, two
partitions) and holds the traffic, requirements and tests. Add the API, the
metadata store, the CDN, how a stored object marks its file ready, and the
four use cases.
