---
type: flip
difficulty: easy
---

## Front

What is the difference between PUT and PATCH, and which is safe to retry?

## Back

**PUT** replaces the whole resource with the body sent, so repeating it gives
the same result: idempotent. **PATCH** applies a partial change; "set the
title" is safe to repeat, but "append an item" or "add 1" is not, so PATCH is
not idempotent in general.
