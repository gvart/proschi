---
updated: 2026-11-10
---

# Built-in types: external services

Services you call but do not run: payments, sign-in, email, SMS, push, maps and AI. Generated from [external.proschi](../../frontend/src/dsl/stdlib/external.proschi); [component types](../TYPES.md) explains how to read and extend them.

## External

A system run by someone else that the design calls over its API.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](core.md#component)
- **Extended by:** [Third Party API](#third-party-api), [Payment Gateway](#payment-gateway), [Auth Service](#auth-service), [Notifier](#notifier), [Analytics Service](#analytics-service), [Google Maps](#google-maps), [OpenAI](#openai)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `GET`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`
- **Write:** `POST`, `PUT`, `PATCH`, `DELETE`
- **Statuses:** `100`, `101`, `102`, `103`, `200`, `201`, `202`, `203`, `204`, `205`, `206`, `207`, `208`, `226`, `300`, `301`, `302`, `303`, `304`, `307`, `308`, `400`, `401`, `402`, `403`, `404`, `405`, `406`, `407`, `408`, `409`, `410`, `411`, `412`, `413`, `414`, `415`, `416`, `417`, `418`, `421`, `422`, `423`, `424`, `425`, `426`, `428`, `429`, `431`, `451`, `500`, `501`, `502`, `503`, `504`, `505`, `506`, `507`, `508`, `510`, `511`
- **Headers:** `Accept`, `Accept-Encoding`, `Accept-Language`, `Accept-Ranges`, `Age`, `Allow`, `Authorization`, `Cache-Control`, `Connection`, `Content-Disposition`, `Content-Encoding`, `Content-Language`, `Content-Length`, `Content-Range`, `Content-Type`, `Cookie`, `Date`, `ETag`, `Expires`, `Host`, `If-Match`, `If-Modified-Since`, `If-None-Match`, `If-Range`, `If-Unmodified-Since`, `Last-Modified`, `Link`, `Location`, `Origin`, `Range`, `Referer`, `Retry-After`, `Server`, `Set-Cookie`, `User-Agent`, `Vary`, `Upgrade`, `WWW-Authenticate`, `Proxy-Authorization`, `Strict-Transport-Security`, `Content-Security-Policy`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, `Access-Control-Allow-Credentials`, `Access-Control-Max-Age`, `Access-Control-Request-Method`, `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Real-IP`, `X-Request-Id`, `X-Correlation-Id`, `Traceparent`, `Tracestate`, `Idempotency-Key`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `X-API-Key`, `X-Content-Type-Options`, `X-Frame-Options`, `Sec-WebSocket-Key`, `Sec-WebSocket-Accept`, `Sec-WebSocket-Protocol`

## Third Party API

Another company's API, whose product does not matter.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** `SEND`, `NOTIFY`, plus 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Payment Gateway

A payment provider: authorizes, captures and refunds card payments.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Extended by:** [Stripe](#stripe), [PayPal](#paypal), [Adyen](#adyen), [Braintree](#braintree)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `RETRIEVE`, plus 5 from [External](#external)
- **Write:** `CHARGE`, `AUTHORIZE`, `CAPTURE`, `REFUND`, `VOID`, `PAYOUT`, plus 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Stripe

Stripe, the payments API.

- **Extends:** [Payment Gateway](#payment-gateway) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 1 from [Payment Gateway](#payment-gateway), 5 from [External](#external)
- **Write:** 6 from [Payment Gateway](#payment-gateway), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## PayPal

PayPal, the online payments service.

- **Extends:** [Payment Gateway](#payment-gateway) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 1 from [Payment Gateway](#payment-gateway), 5 from [External](#external)
- **Write:** 6 from [Payment Gateway](#payment-gateway), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Adyen

Adyen, the payments platform for cards and local payment methods.

- **Extends:** [Payment Gateway](#payment-gateway) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 1 from [Payment Gateway](#payment-gateway), 5 from [External](#external)
- **Write:** 6 from [Payment Gateway](#payment-gateway), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Braintree

Braintree, PayPal's payments API for cards and wallets.

- **Extends:** [Payment Gateway](#payment-gateway) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 1 from [Payment Gateway](#payment-gateway), 5 from [External](#external)
- **Write:** 6 from [Payment Gateway](#payment-gateway), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Auth Service

An identity provider: signs users in and issues and checks their tokens.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Extended by:** [Auth0](#auth0), [Okta](#okta), [AWS Cognito](cloud.md#aws-cognito)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `VALIDATE`, `VERIFY`, `INTROSPECT`, `USERINFO`, `JWKS`, plus 5 from [External](#external)
- **Write:** `LOGIN`, `LOGOUT`, `TOKEN`, `REFRESH`, `REVOKE`, `REGISTER`, plus 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Auth0

Auth0, the hosted identity provider.

- **Extends:** [Auth Service](#auth-service) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [Auth Service](#auth-service), 5 from [External](#external)
- **Write:** 6 from [Auth Service](#auth-service), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Okta

Okta, the identity and single sign-on provider.

- **Extends:** [Auth Service](#auth-service) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [Auth Service](#auth-service), 5 from [External](#external)
- **Write:** 6 from [Auth Service](#auth-service), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Notifier

A provider that delivers messages to people: email, SMS or push notifications.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [External](#external) › [Component](core.md#component)
- **Extended by:** [Email Service](#email-service), [SMS Service](#sms-service), [Push Service](#push-service)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** `SEND`, `NOTIFY`, plus 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Email Service

An email provider that sends the design's emails.

- **Extends:** [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Extended by:** [SendGrid](#sendgrid), [Mailgun](#mailgun), [AWS SES](cloud.md#aws-ses)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## SendGrid

SendGrid, Twilio's email API.

- **Extends:** [Email Service](#email-service) › [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Mailgun

Mailgun, the email API.

- **Extends:** [Email Service](#email-service) › [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## SMS Service

An SMS provider that sends text messages.

- **Extends:** [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Extended by:** [Twilio](#twilio)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Twilio

Twilio, the API for SMS, voice and messaging.

- **Extends:** [SMS Service](#sms-service) › [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Push Service

A push notification provider that delivers to phones.

- **Extends:** [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Extended by:** [APNs](#apns), [FCM](#fcm)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## APNs

Apple Push Notification service, which delivers push notifications to Apple devices.

- **Extends:** [Push Service](#push-service) › [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## FCM

Firebase Cloud Messaging, which delivers push notifications to Android, iOS and the web.

- **Extends:** [Push Service](#push-service) › [Notifier](#notifier) › [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** 2 from [Notifier](#notifier), 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Analytics Service

A product analytics provider that receives usage events.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** 5 from [External](#external)
- **Write:** `TRACK`, `IDENTIFY`, `PAGE`, `SCREEN`, `ALIAS`, plus 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## Google Maps

Google Maps Platform: geocoding, directions, distances and map tiles.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `GEOCODE`, `DIRECTIONS`, `DISTANCE`, `PLACES`, `ROUTES`, `TILES`, plus 5 from [External](#external)
- **Write:** 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)

## OpenAI

OpenAI's API for language models and embeddings.

- **Extends:** [External](#external) › [Component](core.md#component)
- **Kind:** `external`
- **Protocol:** `HTTP`
- **Read:** `COMPLETE`, `CHAT`, `EMBED`, `MODERATE`, `TRANSCRIBE`, plus 5 from [External](#external)
- **Write:** 4 from [External](#external)
- **Statuses:** 61 from [External](#external)
- **Headers:** 69 from [External](#external)
