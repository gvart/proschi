---
type: cloze
difficulty: medium
tags: [availability]
---

## Text

Replication protects against lost disks, but not against a buggy job deleting
objects, because the delete is replicated too. Protect against that with
object {{versioning|backups|snapshots}}.

## Why

Versioning keeps previous versions after an overwrite or delete, and a
lifecycle rule can expire them after a while. Backups to a separate account
also protect against a compromised account.
