---
type: flip
difficulty: medium
---

## Front

How should a service get its database password, and how do you rotate it
without downtime?

## Back

Not from code, the image or the repository: fetch it at runtime from a
**secrets manager** (Vault, AWS Secrets Manager), authenticated by the
workload's own identity, with every read logged. To rotate, let **two
credentials be valid at once**: create the new one, roll it out, then revoke
the old one when nothing uses it.

## Why

Rotate on a schedule and immediately after a leak. Better still are dynamic
credentials: the secrets manager creates a database user per instance that
expires in hours, so there is little to rotate and a leak is short-lived.
