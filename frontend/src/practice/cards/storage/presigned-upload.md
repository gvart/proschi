---
type: flip
difficulty: medium
tags: [api-design]
related: [file-storage, video-streaming]
---

## Front

How do pre-signed URLs let clients upload large files without the bytes
passing through your servers?

## Back

The client asks your API for an upload; the API checks who they are and what
they may upload, then **signs a URL** for one object key that expires in
minutes. The client **PUTs the file directly to object storage** with it. Your
servers handle a small request instead of gigabytes.
