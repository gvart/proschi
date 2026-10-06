---
type: choice
difficulty: medium
tags: [storage]
related: [file-storage, video-streaming]
distinct-from: [presigned-upload]
---

## Question

Private files are shared through signed download URLs. A link gets posted
publicly. What limits the damage best?

## Options

- [x] Short expiry times, minutes rather than days, issued per request after an access check
- [ ] Making the object key hard to guess
- [ ] Deleting the link from where it was posted
- [ ] Checking the user's session cookie at the storage service

## Why

A signed URL is a bearer credential: anyone with it can use it until it
expires, and the storage service never sees your sessions. Revoking one early
usually means revoking the credentials that signed it, which breaks every
URL they signed. So keep links short-lived and re-issue them on demand.
