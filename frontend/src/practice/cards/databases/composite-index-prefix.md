---
type: choice
difficulty: medium
---

## Question

A table has an index on `(country, city)`. Which query **cannot** use it
efficiently?

## Options

- [ ] `WHERE country = 'FR'`
- [ ] `WHERE country = 'FR' AND city = 'Paris'`
- [ ] `WHERE country = 'FR' ORDER BY city`
- [x] `WHERE city = 'Paris'`

## Why

A composite B-tree index is sorted by its first column, then the second, like
a phone book by last name then first name. It serves any **leftmost prefix**
of its columns, but not the second column alone. Some engines (Oracle,
MySQL 8, PostgreSQL 18) can skip-scan it when the first column has few
distinct values, but that is a fallback: a query on `city` alone wants an
index that starts with `city`.
