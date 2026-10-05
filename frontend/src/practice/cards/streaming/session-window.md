---
type: choice
difficulty: medium
tags: [realtime]
distinct-from: [tumbling-window]
---

## Question

You want to group each user's clicks into visits that end after 30 minutes
without a click. Which window fits?

## Options

- [ ] Tumbling window of 30 minutes
- [ ] Sliding window of 30 minutes
- [x] Session window with a 30-minute gap
- [ ] One global window

## Why

Session windows have no fixed length: each closes after a gap of inactivity,
so visits of 2 minutes and 3 hours are both one session. Fixed windows would
cut visits at arbitrary clock boundaries.
