---
type: flip
difficulty: easy
---

## Front

When is eventual consistency good enough, and when is it not?

## Back

**Fine** when a briefly stale value harms no one: like and view counts,
feeds, profile pictures, "last seen". **Not fine** when a decision depends on
the latest value: account balances, the last seat or item in stock, unique
usernames. Many systems mix both, per kind of data.
