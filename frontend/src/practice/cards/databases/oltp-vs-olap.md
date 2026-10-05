---
type: flip
difficulty: medium
tags: [streaming]
---

## Front

Why not run the analytics team's big reports on the production database?

## Back

The production (OLTP) database is a **row store** tuned for many small
transactions; a report scanning millions of rows competes with users for CPU,
memory and I/O. Copy the data (by batch ETL or change data capture) into a
**column-oriented warehouse** (OLAP), which reads only the columns a query
needs and compresses them well.
