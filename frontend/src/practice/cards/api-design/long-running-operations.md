---
type: flip
difficulty: easy
tags: [queues]
related: [video-streaming]
---

## Front

An API call starts a video transcode that takes 10 minutes. How should the
API respond?

## Back

Do not hold the request open. Put the job on a queue and return **202
Accepted** with a job id (and a status URL). The client polls the status, or
gets a webhook or push when the job finishes.
