---
type: flip
difficulty: medium
tags: [estimation]
distinct-from: [hyperloglog]
---

## Front

How can you track exactly which of 100 million users were active each day,
in little memory?

## Back

A **bitmap per day**, with bit *n* set when user *n* is active: 100 million
bits is 12.5 MB. "Active on both days" is a bitwise AND, "either day" an OR,
and counts are exact, unlike HyperLogLog. It needs small, dense integer ids;
sparse ids call for compressed bitmaps such as Roaring.
