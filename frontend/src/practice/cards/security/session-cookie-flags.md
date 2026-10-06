---
type: flip
difficulty: medium
tags: [api-design]
---

## Front

Where should a browser app keep its session token, and with which cookie
flags?

## Back

In a cookie marked **HttpOnly** (page scripts cannot read it, so an XSS bug
cannot steal it), **Secure** (sent only over HTTPS) and **SameSite=Lax** or
**Strict** (not sent with most requests started by other sites). A token in
`localStorage` is readable by every script on the page, so one XSS bug sends
it to the attacker.

## Why

HttpOnly does not make XSS harmless: injected script can still make requests
as the user while the page is open, but it cannot carry the token away.
Cookies bring CSRF instead, which SameSite and CSRF tokens address.
