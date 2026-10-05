---
type: cloze
difficulty: easy
related: [ride-matching]
distinct-from: [geohash-neighbours]
---

## Text

A geohash turns a latitude and longitude into a short string. Points that
share a longer {{prefix}} are in the same, smaller cell, so a database can
find nearby points with a {{range|prefix}} query on an ordinary index.
