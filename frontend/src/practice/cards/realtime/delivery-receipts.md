---
type: cloze
difficulty: easy
related: [chat]
---

## Text

Chat apps show "sent" when the {{server|backend|chat server}} has stored a message, "delivered"
when it reached the recipient's {{device|phone|client|app}}, and "read" when the
recipient opened it.

## Why

Each tick is a separate small event flowing back to the sender, so receipts
multiply message traffic; large groups often aggregate or limit them.
