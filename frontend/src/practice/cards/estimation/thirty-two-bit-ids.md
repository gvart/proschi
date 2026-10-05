---
type: flip
difficulty: medium
tags: [databases]
related: [snowflake-ids]
---

## Front

Why do large tables use 64-bit ids instead of a 32-bit integer column?

## Back

A signed 32-bit integer tops out at about **2.1 billion** (2³¹), and an
unsigned one at about 4.3 billion (2³²). A busy table of events, messages or
likes can pass that in months, and changing the type of a primary key on a
huge table is a painful migration. 2⁶³ is about 9.2 × 10¹⁸, which never runs
out.
