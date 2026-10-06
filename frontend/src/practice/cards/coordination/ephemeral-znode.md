---
type: cloze
difficulty: medium
related: [snowflake-ids]
distinct-from: [zookeeper-etcd-uses]
---

## Text

ZooKeeper deletes an {{ephemeral}} znode automatically when the session of
the client that created it ends, which makes it a natural way to track live
members or hold a lock. etcd does the same with keys attached to a
{{lease}}.

## Why

A client that crashes stops sending heartbeats, its session times out, and
its node disappears; others watching it can take over. Adding a sequence
number (ephemeral sequential nodes) gives each client a unique id or a place
in a lock queue.
