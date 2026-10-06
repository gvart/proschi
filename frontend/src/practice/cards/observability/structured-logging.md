---
type: flip
difficulty: easy
---

## Front

Why write logs as structured events (JSON fields such as `user_id`,
`trace_id`, `duration_ms`) rather than free-text lines?

## Back

Fields can be filtered and aggregated directly ("errors for this customer in
the last hour, by endpoint") instead of parsed with fragile regular
expressions that break when a message is reworded. A `trace_id` field links
each line to its trace.

## Why

Structure does not make logs cheap: log volume grows with traffic, so keep
debug logs off or sampled in production, and never log secrets, tokens or
passwords; redact them in the logging library.
