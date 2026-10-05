---
type: choice
difficulty: easy
tags: [networking]
---

## Question

A page shows live sports scores. Only the server sends updates. Which is the
simplest fit over plain HTTP, with reconnects built into the browser?

## Options

- [x] Server-Sent Events (SSE)
- [ ] WebSockets
- [ ] Long polling
- [ ] WebRTC data channels

## Why

SSE is a long-lived HTTP response streaming events, and the browser's
EventSource reconnects and resumes on its own. WebSockets also work but add a
protocol upgrade and two-way framing that one-way updates do not need.
