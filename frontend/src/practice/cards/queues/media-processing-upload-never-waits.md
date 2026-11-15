---
type: choice
difficulty: easy
tags: [storage]
related: [media-processing]
---

## Question

Users upload files that each need a thumbnail and a document preview. When
should the upload request answer?

## Options

- [ ] After the thumbnail is rendered, so the file list never shows a placeholder
- [ ] After the thumbnail and the preview are both rendered
- [x] Once the original is stored durably and a processing job is enqueued
- [ ] As soon as the bytes arrive, before they are stored

## Why

Rendering inside the request makes every upload pay for the slowest
transformation, and a busy or failing worker pool then slows or fails
uploads. Store the original, enqueue a job and answer; workers fill in the
thumbnail a moment later. Answering before the bytes are stored can lose the
file.
