---
type: flip
difficulty: easy
tags: [databases]
---

## Front

In a storage estimate, what sizes do you assume for a numeric id, a timestamp,
a UUID and a short text field?

## Back

A 64-bit id or timestamp: **8 bytes**. A UUID: **16 bytes** (36 as text). Text:
about 1 byte per character for ASCII, up to 4 in UTF-8, so a 140-character
post is about 140–560 bytes. Round each row up for indexes and overhead.
