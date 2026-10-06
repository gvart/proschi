---
type: choice
difficulty: hard
related: [chat, collaborative-docs]
---

## Question

Why don't large chat apps push every online/offline change to every member of
big groups?

## Options

- [x] Each change goes to every member, so presence traffic grows with the square of the group's size
- [ ] Presence cannot be stored
- [ ] WebSockets cannot carry presence
- [ ] Members' clocks disagree

## Why

In a group of 10,000, each status change goes to 10,000 people, and all
10,000 members keep changing. Apps instead fetch presence lazily for the
people on screen, or show it only in small groups.
