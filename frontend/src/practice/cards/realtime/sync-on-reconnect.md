---
type: cloze
difficulty: medium
tags: [consistency]
related: [chat, collaborative-docs]
---

## Text

After reconnecting, a chat client sends the
{{sequence number|message id|cursor|offset|id|sequence id|sequence|seq|position}}
of the last message it has seen and asks for everything after it, so nothing
that arrived while it was offline is lost.

## Why

The live connection is only a fast path. The stored conversation, read from a
known position, is what guarantees completeness.
