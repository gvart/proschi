---
type: cloze
difficulty: hard
tags: [realtime]
---

## Text

Before a client can send its first HTTPS request, a TCP handshake plus a
TLS 1.3 handshake cost {{2|two}} round trips. QUIC (HTTP/3) combines them into
{{1|one}}.

## Why

TLS 1.2 needed two round trips of its own, so three in total. With session
resumption, TLS 1.3 and QUIC can even send data in the first flight (0-RTT),
at the cost of replay risk for that data.
