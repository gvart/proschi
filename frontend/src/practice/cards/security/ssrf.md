---
type: choice
difficulty: hard
tags: [networking]
---

## Question

A "link preview" feature makes the server fetch any URL a user pastes. What
is the main risk?

## Options

- [ ] Cross-site scripting in the user's browser
- [x] Server-side request forgery: the server fetches internal addresses such as the cloud metadata service
- [ ] CSRF against the user's session
- [ ] Clickjacking

## Why

The server sits inside the network: `http://169.254.169.254/` can hand out
cloud credentials, and internal admin APIs trust it. Allow only http(s),
resolve the host and block private and link-local ranges (again after every
redirect, against DNS rebinding), fetch through an isolated egress proxy and
require token-based metadata access (IMDSv2).
