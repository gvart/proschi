---
type: choice
difficulty: medium
tags: [availability]
---

## Question

Pages are slow only for users on mobile networks in one country. Which
monitoring is most likely to catch it?

## Options

- [ ] Synthetic checks that load the page every minute from three cloud regions
- [x] Real-user monitoring, which measures page loads in the users' own browsers
- [ ] CPU metrics of the web servers
- [ ] A health check on the load balancer

## Why

Synthetic checks run scripted paths from fixed places, so they see only what
they were set up to see; they shine at catching an outage when no users are
around, such as at night or in a new region. Real-user monitoring sees real
devices and networks, but needs traffic and is noisier.
