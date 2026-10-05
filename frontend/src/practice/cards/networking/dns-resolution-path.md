---
type: cloze
difficulty: easy
---

## Text

On a cache miss, a recursive DNS resolver asks the {{root}} servers, then the
{{TLD|top-level domain|top level domain}} servers (such as `.com`), and finally
the domain's {{authoritative}} name servers.

## Why

Each answer is cached for its TTL, so most lookups never leave the resolver.
