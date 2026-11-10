---
updated: 2026-11-10
---

# Built-in types: clients, shapes, notes and groups

The root type `Component`, the clients that send the first request, and the shapes, notes and group boxes that only draw. Generated from [core.proschi](../../frontend/src/dsl/stdlib/core.proschi); [component types](../TYPES.md) explains how to read and extend them.

## Component

Anything drawn on the diagram: the root of every type.

- **Abstract.** A node uses a type that extends it.
- **Extended by:** [Caller](#caller), [Shape](#shape), [Annotation](#annotation), [Group](#group), [Edge](edge.md#edge), [Compute](compute.md#compute), [Data](data.md#data), [Messaging](messaging.md#messaging), [External](external.md#external)

## Caller

Whoever sends the first request: a person, a browser or an app.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](#component)
- **Extended by:** [Actor](#actor), [Browser](#browser), [Mobile App](#mobile-app)
- **Kind:** `client`

## Actor

A person who uses the system.

- **Extends:** [Caller](#caller) › [Component](#component)
- **Kind:** `client`

## Browser

A web browser running the site's pages.

- **Extends:** [Caller](#caller) › [Component](#component)
- **Kind:** `client`

## Mobile App

An iOS or Android app on the user's phone.

- **Extends:** [Caller](#caller) › [Component](#component)
- **Kind:** `client`

## Shape

A plain shape, drawn without a product icon; it simulates as a client.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](#component)
- **Extended by:** [Rectangle](#rectangle), [Circle](#circle), [Diamond](#diamond), [Cylinder](#cylinder), [Cloud](#cloud)
- **Kind:** `client`

## Rectangle

A plain rectangle.

- **Extends:** [Shape](#shape) › [Component](#component)
- **Kind:** `client`

## Circle

A plain circle.

- **Extends:** [Shape](#shape) › [Component](#component)
- **Kind:** `client`

## Diamond

A plain diamond, often used for a decision.

- **Extends:** [Shape](#shape) › [Component](#component)
- **Kind:** `client`

## Cylinder

A plain cylinder, the usual sketch of storage.

- **Extends:** [Shape](#shape) › [Component](#component)
- **Kind:** `client`

## Cloud

A plain cloud shape, for the internet or a provider you do not detail.

- **Extends:** [Shape](#shape) › [Component](#component)
- **Kind:** `client`

## Annotation

A note on the diagram that takes no part in the simulation.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](#component)
- **Extended by:** [Note](#note), [Text Note](#text-note), [Sticky Note](#sticky-note), [Comment](#comment)
- **Kind:** `other`

## Note

A note shape with text, for remarks next to the components.

- **Extends:** [Annotation](#annotation) › [Component](#component)
- **Kind:** `other`

## Text Note

Free text placed on the canvas.

- **Extends:** [Annotation](#annotation) › [Component](#component)
- **Kind:** `other`

## Sticky Note

A sticky note on the canvas.

- **Extends:** [Annotation](#annotation) › [Component](#component)
- **Kind:** `other`

## Comment

A review comment on the canvas.

- **Extends:** [Annotation](#annotation) › [Component](#component)
- **Kind:** `other`

## Group

A box drawn around components that belong together.

- **Abstract.** A node uses a type that extends it.
- **Extends:** [Component](#component)
- **Extended by:** [Logical Group](#logical-group), [Network Boundary](#network-boundary), [Security Zone](#security-zone), [Service Group](#service-group)
- **Kind:** `other`

## Logical Group

A box around components that form one part of the design.

- **Extends:** [Group](#group) › [Component](#component)
- **Kind:** `other`

## Network Boundary

A box around components in one network, such as a VPC or a subnet.

- **Extends:** [Group](#group) › [Component](#component)
- **Kind:** `other`

## Security Zone

A box around components that share one trust level.

- **Extends:** [Group](#group) › [Component](#component)
- **Kind:** `other`

## Service Group

A box around the components one team or service owns.

- **Extends:** [Group](#group) › [Component](#component)
- **Kind:** `other`
