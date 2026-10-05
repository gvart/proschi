---
type: cloze
difficulty: easy
tags: [databases]
---

## Text

A search engine keeps, for each word, the list of documents that contain it.
This structure is an {{inverted index|inverted}}.

## Why

A query for several words intersects their lists. That is why a search
engine such as Elasticsearch answers text queries that a B-tree on the whole
column cannot.
