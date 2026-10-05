---
type: flip
difficulty: hard
related: [chat, snowflake-ids]
---

## Front

How should a chat service order the messages in a conversation?

## Back

Have the **server assign a sequence number per conversation** (or a
time-ordered id) when it stores each message, not trust client clocks, which
drift. Clients sort by that number, and a gap tells them a message is missing
and should be fetched.
