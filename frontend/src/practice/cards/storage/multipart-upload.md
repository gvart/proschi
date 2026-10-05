---
type: cloze
difficulty: easy
related: [video-streaming, file-storage]
---

## Text

Large files go to S3 with {{multipart upload|multipart|multi-part upload}}:
the file is sent in parts that upload in {{parallel}}, and a failed part is
retried on its own.

## Why

Without it, a network blip at 90% of a 5 GB upload means starting over. Parts
can also be uploaded with pre-signed URLs, one per part.
