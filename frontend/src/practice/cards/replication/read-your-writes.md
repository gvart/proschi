---
type: cloze
difficulty: medium
decks: [sample]
tags: [consistency]
---

## Text

A user updates their profile, reloads, and sees the old version because the
read went to a lagging replica. That breaks {{read-your-writes|read your writes|read-your-own-writes|read your own writes}}
consistency.

## Why

Common fixes: read the user's own data from the leader for a short while after
they write, or send the write's position with the read so a replica answers
only once it has caught up.
