---
type: cloze
difficulty: medium
tags: [resilience]
---

## Text

In SQS, a message a consumer has received is hidden from other consumers for
the {{visibility timeout}}. If the consumer does not delete it before that
ends, the message becomes visible and is {{redelivered|delivered again|retried}}.

## Why

Set the timeout longer than processing normally takes, or extend it while
working, or slow messages will be processed twice in parallel.
