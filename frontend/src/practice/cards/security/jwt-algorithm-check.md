---
type: choice
difficulty: hard
---

## Question

A service receives a JWT whose header says `"alg": "none"`. What should it
do?

## Options

- [ ] Accept it if the payload's `exp` is still in the future
- [x] Reject it: accept only the algorithm and key the service expects, never the one the token names
- [ ] Accept it only from internal callers
- [ ] Verify it with the HMAC secret instead

## Why

Libraries that trusted the header have accepted unsigned tokens (`none`) and
tokens signed with HMAC using the public RSA key as the secret. Pin the
algorithm and key, then check `exp`, the issuer (`iss`) and the audience
(`aud`), so a token minted for another service is refused.
