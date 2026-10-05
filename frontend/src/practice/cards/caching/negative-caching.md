---
type: cloze
difficulty: easy
tags: [resilience]
---

## Text

Storing "this key does not exist" in the cache, so repeated lookups for a
missing item do not all reach the database, is called
{{negative caching|caching negative results|negative cache}}.

## Why

Without it, a client (or an attacker) asking for random missing ids sends
every request straight to the database. Give negative entries a short TTL, so
an item created later appears quickly; a Bloom filter of existing keys is
another guard.
