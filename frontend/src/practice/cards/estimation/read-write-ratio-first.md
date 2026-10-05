---
type: flip
difficulty: easy
---

## Front

Why work out the read-to-write ratio early in a design, and what does each
answer point to?

## Back

It decides where the effort goes. **Read-heavy** (e.g. 100:1): caches, read
replicas and CDNs. **Write-heavy**: sharding for write capacity, log-structured
storage, and batching or queues to absorb bursts.
