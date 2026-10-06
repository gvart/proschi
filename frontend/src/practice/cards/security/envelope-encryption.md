---
type: flip
difficulty: hard
tags: [storage]
---

## Front

What is **envelope encryption** with a KMS, and why not send all the data to
the KMS to encrypt?

## Back

Encrypt the data locally with a **data key**, then have the KMS encrypt
(wrap) that data key with a **master key** that never leaves the KMS; store
the wrapped data key next to the data. Only a few hundred bytes go to the
KMS per data key, so gigabytes are encrypted at local speed, and every
unwrap is authorized and logged.

## Why

KMS encrypt calls take only small payloads (4 KB in AWS KMS) and are
rate-limited. Rotating the master key means re-wrapping small data keys, not
re-encrypting the data, and deleting a key makes everything under it
unreadable (crypto-shredding).
