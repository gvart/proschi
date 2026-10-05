---
type: flip
difficulty: hard
tags: [databases]
---

## Front

What is a **skip list**, and where is it used?

## Back

A sorted linked list with extra "express" levels, each skipping over more
nodes, with node levels chosen at random. Search and insert take O(log n) on
average, like a balanced tree, but it is simpler and easier to make
concurrent. Redis sorted sets and the memtables of LevelDB and RocksDB use
one.
