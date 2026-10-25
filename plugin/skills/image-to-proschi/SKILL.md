---
name: image-to-proschi
description: Turn an image of an architecture diagram (a screenshot, PNG, JPG or PDF export from draw.io, Lucidchart, Miro, Excalidraw, Visio or a whiteboard photo) into a Proschi (.proschi) model that keeps the source's components, groups, arrows, legend and reading order, passes `proschi check` and renders cleanly. Use when the user shares or points at a picture of a system diagram and asks to convert, recreate, redraw, digitise or "make this diagram as code" in Proschi.
license: MIT
---

# Architecture image → Proschi

Goal: one `.proschi` file that says what the picture says (same components,
groups, arrows and legend, read in the same order), with every unreadable or
uncertain part marked, that passes `npx proschi@latest check`, has been
rendered and looked at, and a share link for the user.

Read [references/proschi-cheatsheet.md](references/proschi-cheatsheet.md)
first, above all its *Layout* section and the colors and legend syntax.
This skill adds what reading a picture needs: the inventory, the legend
mapping and keeping the source's order.

## 1. Inventory before you write any Proschi

Write the inventory down (in your notes, not the file). Big images: look at
them in tiles or crops until every label is readable; don't guess small text.

- [ ] **Legend**: each swatch or line style and its meaning. Also styles the
      legend does not explain (a grey box, a dashed arrow).
- [ ] **Groups**: each drawn boundary (box, zone, cloud badge, a cylinder
      holding topics), its title or logo, its members, and what sits on its border.
- [ ] **Components**: name, the text in brackets (language, tech or owning
      team), fill color, badges (a warning triangle, a stack meaning replicas),
      icons drawn inside a box (a cache or database the service owns).
- [ ] **Edges**: source → target *as drawn* (the arrowhead end is the target),
      label, color and dash. Note double-headed arrows.
- [ ] **Spatial bands**: what is at the top, the middle and the bottom, and
      left to right within each band. Where the eye starts.

Count each list; check the counts again at the end.

## 2. Map the legend first

| In the picture | In Proschi |
|---|---|
| Fill color meaning an owner, team or lifecycle | `legend` entry (nearest palette name) + `.tag` on each node or group |
| Line color or dash meaning planned, deprecated, async | `legend` entry with `dashed`/`dotted` if drawn so + `.tag` on the edge |
| Warning or "critical" badge | `critical` on the node |
| A style the legend never explains | a `legend` entry only if it is clearly deliberate, else a `# NOTE:` comment |
| Colors with no legend at all | no `color`: let the category tints show the kind |

One tag per node or edge: if a box is both "external" and "deprecated",
pick the meaning the reader needs most and put the other in a comment.

## 3. Nodes, groups, edges

- **Nodes**: one per box. The tech from the label (`[Kotlin]`, `[NodeJS]` →
  `[Node.js]`, an AWS icon → its catalog tech); a box labelled with a team →
  the closest kind (`[Service]`, `[Third Party API]`) and `@team-name`. The
  same system drawn twice → one node, with a comment.
- **Icons inside a box** (a cache, a DB, a search index) → the box's
  description (`"Kotlin; ElastiCache Redis, RDS"`), unless an arrow from
  elsewhere ends on them: then their own node, declared right after the box.
- **Names**: about 18 characters fit on a card. Longer → a shorter name and
  the full text in the description (`"Order Fulfillment API"` → `"OF API"`).
- **Groups**: one per drawn boundary; an untitled one is named after its
  badge (`group aws "AWS eu-west-1"`, `[Network Boundary]` for a cloud or
  VPC). A cluster drawn with topics inside → a group of topic nodes. A box
  on a group's border is inside it unless its color says it is external.
  Keep a one-member group when the picture draws it.
- **Edges**: keep the drawn direction; it is the author's claim. A
  double-headed arrow → one edge from the caller (`# GUESS:` the direction).
  The label → `label [protocol]` as written. Arrows from a whole zone → one
  edge from the group.

Mark anything you could not read or had to infer: `# GUESS:`, `# UNREADABLE:`.

## 4. Keep the source's reading order

The auto-layout knows nothing about the picture's positions; declaration
order and the hints carry them:

- [ ] Declare band by band, top to bottom, and left to right inside a band;
      inside each group in the same way. A box that only one zone talks to
      is declared next to that zone.
- [ ] Siblings always in the source's left-to-right order (top-to-bottom for
      a vertical stack): the layout keeps declaration order wherever that
      adds no crossings, so the render follows the picture's order.
- [ ] `layout ordered` at the top, so the bands keep the declared order even
      where arrows point up (keep the arrows as drawn).
- [ ] Render now (step 6) before adding any other hint. Then add them one
      at a time, rendering after each and reverting any that adds crossings:
- [ ] `rank` on the group tiers first (`rank 0` for the top zone, `rank 1`
      for the next); a top row of single boxes only where alignment
      matters. Boxes with an edge between them can't share a rank.
- [ ] A zone drawn as a row (Kafka topics, a cluster) → `direction right`
      inside its group.
- [ ] Side-by-side zones (two regions): the same `rank` works only when no
      edge joins them. Otherwise wrap them in one group with `direction
      right`, and put `direction down` inside each zone (nested groups
      inherit the direction).
- [ ] `pos x,y` only to nudge one or two nodes at the very end.

## 5. Validate

```sh
npx proschi@latest fmt diagram.proschi
npx proschi@latest check --strict diagram.proschi
```

Fix every error and warning (`Unknown tech stack` → a catalog tech or the
generic one of its kind, with the product in the name).

## 6. Render and compare (mandatory)

```sh
npx proschi@latest render --out /tmp/proschi-review diagram.proschi
```

Put `/tmp/proschi-review/architecture.svg` next to the source image. If you
only read raster images, convert it first (`rsvg-convert -w 2000
architecture.svg -o review.png`, `magick`, or a headless-browser screenshot;
macOS `qlmanage -t` crops tall images). Check:

- [ ] Every inventoried component, group and edge is there (recount).
- [ ] The bands read in the same order; groups sit where the source has them.
- [ ] The legend panel matches the source legend, and the tags color the
      right boxes and lines.
- [ ] The cheat-sheet's review checklist: crossings, edges against the flow,
      stranded nodes, sprawl.

Fix the file (order, group edges, regrouping, then one hint at a time;
`pos` last), `check`, render again. Keep a change only if the render got
better; revert one that adds crossings. Stop after about five rounds and say what still differs.

## 7. Hand over

```sh
npx proschi@latest share-link diagram.proschi
```

Give the user: the file, the link, the render you checked, the guesses and
unreadable labels to confirm, and what the language cannot show (provider
logos, curved routes, exact positions).

## Worked example

Picture: top, a "Mobile app" box. Middle, a green zone "Checkout (team
Payments)" with "Checkout API [Go]" (warning badge) above a "Session cache
[Redis]" box. Bottom, a yellow "Stripe [External]" box. A red dashed arrow from the
API to a grey "Legacy invoicing" box. Legend: green = owned by Payments,
yellow = external, red dashed = deprecated flow.

```proschi
title "Checkout"
layout ordered

legend {
  owned      "Owned by Payments" green
  external   "External"          yellow
  deprecated "Deprecated flow"   red dashed
}

app "Mobile app" [Mobile App]

group checkout "Checkout" .owned {
  api   "Checkout API"  [Go]    @payments critical
  cache "Session cache" [Redis]
}

stripe  "Stripe"           [Stripe]          .external
invoice "Legacy invoicing" [Third Party API] # NOTE: grey box, not in the legend

app -> api                 : Checkout [https]
api -> cache               : Sessions
api -> stripe              : Charge [https]
api -> invoice .deprecated : Invoice [soap]
```
