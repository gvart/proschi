---
type: cloze
difficulty: medium
tags: [consistency]
related: [chat]
---

## Text

After reconnecting, a chat client asks for every message after the last
{{sequence number|message id|cursor|offset}} it has seen, so nothing that
arrived while it was offline is lost.

## Why

The live connection is only a fast path. The stored conversation, read from a
known position, is what guarantees completeness.
