# Colors, legend and layout (temporary implementation doc)

Shared source of truth for the multi-agent run. Delete in the final change.

## Decisions
- D1 Default colors by category: ~6 families (services, data stores, queues/streams, edge/gateway, clients, external) mapped from the 17 kinds; tuned for light and dark.
- D2 Color syntax: named palette (`color teal`, theme-aware) plus `color #hex` escape hatch, on nodes and groups.
- D3 Legend entries are styles: `legend { owned "Owned by OF" green ... }`, applied with `.tag` on nodes, groups and edges. Edge tags go before the colon: `a -> b .planned : label`. Legend panel shown only when a `legend` block exists.
- D4 Precedence: explicit `color` > tag > category default. Load overlay still wins during simulation.
- D5 `critical` marker on nodes draws a warning badge.
- D6 Layout: ELK orthogonal routes with ports on all sides, model order, new hints `direction down|right|up|left` (top level and per group) and node `rank N`.
- D7 Skills rewritten around edge direction, tiers, grouping, hints, colors, legend, and a mandatory render-and-review loop; new image-to-diagram skill.
- Out of scope: provider logos on groups, data stores embedded in service boxes.

## Work items
- [ ] 1 style-lang: colors, legend, tags, critical, rendering, tooling, docs
- [ ] 2 layout-engine: orthogonal routing, ports, model order, metrics harness + reference fixture (parallel with 1)
- [ ] 3 layout-hints: `direction`, `rank` (depends on 1, 2)
- [ ] 4 skills: rewrite + acceptance test against the reference image (depends on 3)

## Acceptance test
A fresh agent with only the skills and the reference image produces a well-structured diagram; compared side by side with the reference.
