---
type: choice
difficulty: easy
---

## Question

Which change to a JSON API breaks existing clients?

## Options

- [ ] Adding a new endpoint
- [ ] Adding a new field to a response
- [ ] Adding an optional query parameter
- [x] Renaming a field in a response

## Why

Clients that read the old name find nothing. Additive changes are safe as long
as clients ignore fields they do not know, which is why API guidelines ask
them to.
