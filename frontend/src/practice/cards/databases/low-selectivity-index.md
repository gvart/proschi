---
type: choice
difficulty: medium
distinct-from: [cost-of-an-index]
---

## Question

Which column gains the least from a B-tree index of its own?

## Options

- [ ] `email`, looked up to log users in
- [ ] `created_at`, used for "last 7 days" range queries
- [ ] `user_id` on an orders table, used to list one user's orders
- [x] `is_active`, true for about half the rows

## Why

An index pays off when it narrows a query to a small fraction of the rows. A
filter matching half the table reads so many rows that a full scan is
cheaper, and the planner will usually ignore the index while every write
still pays to maintain it.
