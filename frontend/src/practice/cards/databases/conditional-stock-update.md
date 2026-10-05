---
type: choice
difficulty: medium
tags: [consistency]
related: [flash-sale, ticket-booking]
---

## Question

In a flash sale, how do you decrement stock so it never goes below zero?

## Options

- [ ] Read the stock in the app, check it is above 0, then write stock − 1
- [x] `UPDATE items SET stock = stock - 1 WHERE id = ? AND stock > 0`, and check the rows affected
- [ ] Keep the count in each app server's memory
- [ ] Decrement a Redis counter and copy it to the database every minute

## Why

Read-then-write lets two buyers read 1 and both write 0. A conditional update
is atomic in the database: one buyer's update affects a row, the other's
affects none and gets "sold out".
