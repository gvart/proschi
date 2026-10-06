---
type: flip
difficulty: medium
tags: [api-design]
---

## Front

Why does a mobile app or single-page app use the OAuth authorization code
flow **with PKCE**?

## Back

The app cannot keep a client secret: anyone can unpack it. So it makes a
random **code verifier**, sends only its hash (the code challenge) with the
authorization request, and must present the verifier to exchange the code
for tokens. An attacker who intercepts the authorization code (a hijacked
redirect, a log) cannot redeem it without the verifier.

## Why

PKCE replaced the implicit flow, which returned tokens in the redirect URL
where they could leak through history and referrers. Current guidance
(OAuth 2.1) recommends PKCE for every client, even ones with a secret.
