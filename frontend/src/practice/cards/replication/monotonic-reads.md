---
type: cloze
difficulty: medium
tags: [consistency]
distinct-from: [read-your-writes]
---

## Text

A user sees a new comment, refreshes, and it is gone, because the second read
went to a replica further behind. The guarantee that prevents this is
{{monotonic reads|monotonic read|monotonic-read}}.

## Why

A simple fix is to route each user's reads to the same replica (for example by
hashing the user id), so time never appears to move backwards for them.
