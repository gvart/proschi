---
type: choice
difficulty: medium
tags: [replication]
distinct-from: [rto-and-rpo]
---

## Question

Which setup loses no acknowledged writes if the database's availability zone
is destroyed?

## Options

- [ ] Nightly backups to object storage
- [ ] Asynchronous replication to another zone
- [x] Synchronous replication to another zone before each commit is acknowledged
- [ ] Hourly disk snapshots

## Why

Only a synchronous copy guarantees every acknowledged write exists elsewhere
(an RPO of zero). Asynchronous replication loses the last seconds, and backups
or snapshots lose everything since they were taken.
