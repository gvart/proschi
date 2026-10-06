---
type: choice
difficulty: medium
related: [metrics-ingest]
---

## Question

Which label on a `http_requests_total` counter is most likely to overload
the metrics database?

## Options

- [ ] `status_code`
- [ ] `method`
- [x] `user_id`
- [ ] `region`

## Why

Every distinct combination of label values is a separate time series. A few
status codes × methods × regions make hundreds; millions of users make
millions, each with its own memory and index cost. Keep unbounded values
(user ids, request ids, full URLs) in logs and traces.
