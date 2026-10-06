---
type: flip
difficulty: medium
tags: [consistency]
related: [chat, collaborative-docs]
---

## Front

When should a chat server acknowledge a message to its sender?

## Back

After the message is **durably stored**, and before delivering it. The ack is
a promise that the message will not be lost. Delivery to the recipient (over
their connection or by push) happens afterwards, and can be retried from the
store if it fails.
