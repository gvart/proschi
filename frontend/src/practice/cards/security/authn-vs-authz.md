---
type: cloze
difficulty: easy
tags: [api-design]
---

## Text

Checking **who** is calling is {{authentication|authn}}; checking **what**
that caller is allowed to do is {{authorization|authz}}.

## Why

They fail differently: a missing or bad credential is `401 Unauthorized`
(despite the name, an authentication failure), a valid user without the
right is `403 Forbidden`. Authorization must be checked on every object, not
only at login: "is this invoice yours?" is the check most often forgotten.
