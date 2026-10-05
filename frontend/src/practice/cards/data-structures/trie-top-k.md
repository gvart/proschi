---
type: flip
difficulty: medium
related: [search-autocomplete]
---

## Front

How does a trie make autocomplete fast enough for every keystroke?

## Back

Each node is a prefix, and it stores a **precomputed list of the top
suggestions** under it. A keystroke walks to the node for the typed prefix
and returns its list, with no search. The lists are rebuilt offline from
query logs, and the hottest prefixes can be cached at the edge.
