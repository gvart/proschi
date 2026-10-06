---
type: choice
difficulty: medium
tags: [storage, databases]
---

## Question

The cloud database encrypts its disks at rest with a managed key. Which
attack does that stop?

## Options

- [x] Reading a stolen disk, a discarded drive or a copied raw volume outside the service
- [ ] An attacker logging in with the app's leaked database password
- [ ] SQL injection through the app
- [ ] Someone sniffing traffic between the app and the database

## Why

The storage layer decrypts transparently for anyone the database lets in, so
stolen credentials and injection see plaintext. Traffic needs encryption in
transit (TLS). For data that must stay unreadable even to someone holding
the database login, encrypt fields in the application with keys from a KMS.
