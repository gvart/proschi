---
type: cloze
difficulty: easy
distinct-from: [jwt-algorithm-check]
---

## Text

Anyone holding a signed JWT can read its claims: the payload is only
{{base64url|base64|base64 url|base 64|b64}}-encoded, not encrypted. The signature proves the claims
were not {{changed|modified|tampered with|altered|tampered|forged|edited|manipulated}}.

## Why

Do not put secrets or sensitive personal data in a JWT; it ends up in
browser storage, logs and proxies. If the claims must be hidden, encrypt them
(JWE) or use an opaque token that points to server-side data.
