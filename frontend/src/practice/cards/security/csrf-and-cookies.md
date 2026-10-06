---
type: choice
difficulty: medium
distinct-from: [session-cookie-flags]
---

## Question

Why is an app that authenticates with a session cookie exposed to CSRF, while
one that sends a bearer token in the `Authorization` header is not?

## Options

- [x] The browser attaches cookies automatically, even to requests another site triggers
- [ ] Cookies are sent unencrypted
- [ ] Bearer tokens expire sooner than cookies
- [ ] CSRF only works against GET requests

## Why

A malicious page can submit a form to your site, and the browser adds your
cookie. A header must be set by your own page's script, which other origins
cannot do. Defend cookie sessions with `SameSite`, a CSRF token on
state-changing requests, and never changing state on GET.
