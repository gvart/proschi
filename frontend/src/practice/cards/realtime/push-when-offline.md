---
type: choice
difficulty: easy
tags: [queues]
related: [chat, notification-fanout]
---

## Question

The recipient's phone app is closed. How does a new chat message reach them?

## Options

- [ ] Keep the app's WebSocket open in the background forever
- [x] Send a push notification through APNs or FCM; the app fetches messages when opened
- [ ] Retry the WebSocket every second until the app opens
- [ ] Send an SMS for every message

## Why

Mobile operating systems close background connections to save battery, and
only their own push services (APNs for iOS, FCM for Android) can wake the
device.
