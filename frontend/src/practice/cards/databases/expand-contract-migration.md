---
type: choice
difficulty: medium
---

## Question

You need to split `full_name` into `first_name` and `last_name` on a busy
table, while old app versions keep reading `full_name`. Which order does it
with no downtime and no broken readers?

## Options

- [ ] Rename the column in one `ALTER TABLE`, then deploy the new code
- [ ] Deploy code that reads the new columns, then add them
- [x] Add the new columns, write both, backfill old rows, switch reads, and drop `full_name` once nothing reads it
- [ ] Copy the table, swap the names in a transaction, and drop the old one

## Why

This is expand and contract. Expanding (new nullable columns, dual writes)
is additive, so old code keeps working. The backfill fills the rows written
before the dual writes began. Reads switch only once every row has the new
shape, and the contract step drops the old column only after the last
reader of it is gone. Each step is its own deploy and can be rolled back
until the drop. A one-shot rename locks a big table and breaks every reader
of the old name at once.
