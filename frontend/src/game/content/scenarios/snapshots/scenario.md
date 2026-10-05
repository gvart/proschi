---
title: Snapshots
summary: "A photo sharing app where bytes, not requests, are the problem: bandwidth, egress and a CDN."
difficulty: medium
tags: [storage, cdn, bandwidth, cost]
related: [pastebin]
cards: [object-vs-block-storage, presigned-upload, egress-bill, cdn-cache-control, metadata-vs-content]
order: 2
version: 1
---

## Briefing

Snapshots lets people share photos. The request rates are small next to a URL
shortener, but every view sends a 20 KB image and every upload brings 2 MB.
Bytes fill app server bandwidth, and every byte you send to the internet is on
the bill. Keep photos fast and cheap to serve.

## Act 1

Beta. Files go to object storage, metadata to the database. Uploads stream
through the app servers, so watch their bandwidth as well as their requests.

## Act 2

Growth. The home feed reads twenty photos at a time, thumbnails are made in
the background, and the board wants the bill under control.

## Act 3

Scale. Users abroad, an uploads availability target, and a celebrity whose
photo everyone opens at once.

## Debrief: egress

Sending a gigabyte to the internet from your own servers costs about $0.09; a
CDN sends it for about $0.02 and answers from near the user. At a few hundred
views a second, egress is most of the bill. Cache images at the edge, keep the
origin's share small, and let users upload straight to storage with presigned
URLs instead of streaming files through your app servers.

## Interview translation

Separate metadata from content: rows in a database (cached), files in object
storage. Serve images through a CDN with long cache lifetimes and versioned
URLs, which cuts both latency for far users and the egress bill. Uploads go
directly to object storage with presigned URLs; a queue triggers workers that
make thumbnails, so the upload returns at once. The feed reads many small
rows, so it is cached and the database gets read replicas.
