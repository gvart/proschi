---
type: flip
difficulty: medium
---

## Front

Old versions of your mobile app stay installed for years. How do you change
the API without breaking them?

## Back

Make changes **additive** only: new fields and endpoints, never removing or
renaming. Put breaking changes in a **new version** (e.g. `/v2`), keep the old
one running, track which clients still call it, and retire it only when usage
is negligible, announcing a sunset date first.
