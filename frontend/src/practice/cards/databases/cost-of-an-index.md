---
type: flip
difficulty: easy
decks: [sample]
---

## Front

An index makes reads on a column fast. What does it cost?

## Back

Every insert, update and delete must also update the index, so **writes get
slower**, and the index takes **storage and memory**. Index the columns your
queries filter and sort by, not every column.
