---
type: flip
difficulty: medium
tags: [data-structures]
related: [file-storage]
---

## Front

How can a file sync service avoid storing the same bytes twice?

## Back

Split files into chunks and name each chunk by the **hash of its content**.
An identical chunk, from another user or another version of the file, has the
same name and is stored once; the client checks which hashes the server
lacks and uploads only those. The cost: tracking references before deleting
a chunk.
