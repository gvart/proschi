---
type: flip
difficulty: hard
tags: [resilience]
---

## Front

What is a cell-based architecture, and what does it buy?

## Back

The service is split into many independent copies (**cells**), each with its
own servers and data, serving a fixed slice of users; a thin router sends each
user to their cell. A bad deploy, a poison request or an overload hits **one
cell's users**, not everyone. Changes can roll out cell by cell.
