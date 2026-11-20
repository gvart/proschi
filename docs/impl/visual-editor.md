# Visual editor redesign (temporary implementation doc)

Delete this file and `visual-editor-design.md` in the change that completes the work.

**Goal:** make adding components and building flows on the canvas easy for
first-time users and fast for experienced ones. Every list the UI offers
comes from the document's types, never from hard-coded strings. The canvas,
the Flows panel and the code are three views of one text.

The full review (problems with evidence, the design, what's new, slices) is in
[`visual-editor-design.md`](visual-editor-design.md). Read its sections 2 and 4
before taking a slice. Before screenshots for the blog post are in the session
scratchpad (`editor-review/*.png`).

## Decisions

- **All 9 slices ship** in one feature branch `feat/visual-editor`, one PR.
- **Types without operations or statuses:** free text plus labels already used
  in the document, and a "give it operations" link that writes a type. The UI
  invents nothing, and the stdlib does not change.
- **Ids follow names** only while the id is still the generated one
  (`rest_api`, `postgresql2`); ids the user typed are never touched.
- **New connections carry the target type's `protocol`** exactly as the type
  declares it (`api -> db : SQL`); no protocol means a bare arrow.
- **Warning labels may be added**, with the warning shown first; problems with
  `strict: true` block, as the language already does.
- **Default layout stays Split**, with a minimum fit zoom so nodes stay readable.
- **No payload schema in types** (a separate language feature).
- Both canvases (`Playground/DiagramView.tsx`, `Diagram/EditableCanvas.tsx`)
  get every change; shared logic moves into `components/Diagram/`.

## Work items

- [x] **S1 Type-driven step vocabulary.** `stepVocabulary(diagram, from, to, kind)` in `dsl/typesys/vocabulary.ts` replaces `labelSuggestions`; feeds the composer and `proschiLanguage.ts` completion. verify: unit test that every offered op/status/header for every concrete stdlib type and a user type yields no unknown-op/status/header diagnostic; e2e Flows tests updated. depends on: —
- [x] **S2 Connect that works.** Drop anywhere on the target's body, zoom-independent hit area, hover highlight, `addConnection` with protocol label, protocol picker in the edge inspector. verify: `edit.test.ts`; e2e drag to node centre at zoom 0.5 writes `a -> b : SQL`. depends on: —
- [x] **S3 Flows loop and empty state.** Visible New use case button, chain continuation, Reply, composer stays open, live diagnostic for the candidate line, row hover linked to canvas and code; shared `useStepPick`. verify: `flows.test.ts`; e2e five steps in five picks + Enters. depends on: S1
- [x] **S4 Edit steps; show everything.** `setStep`, `moveStep`, positional `addStep`, `renameUseCase`, `renameScenario`; `outlineOf` models `par`; `-x` drawn and creatable. verify: `editFlows.test.ts` incl. untouched lines byte-identical over all practice solutions; e2e reorder. depends on: S3
- [x] **S5 Composer details.** Headers, payload, `x<N>`, `~size`, open-type path, "give it operations" (`addType`); `StepComposer.tsx`, `composeLabel`. verify: `composeLabel` → parse round-trip unit tests. depends on: S1, S3
- [ ] **S6 Adding flow.** Add connected to the selection, "+" on hovered nodes, drop on empty canvas opens the picker, readable fit, in-place naming, `renameId`, empty-state chips, overlap fixes. verify: `renameId` over every practice solution; e2e three clicks give `client -> api -> db`. depends on: S2
- [ ] **S7 Selection tab.** Inspector docked in the rail, `TypePicker.tsx` with the document's types, type card. verify: unit picker lists a declared type; e2e no panel overlaps a node. depends on: S6
- [ ] **S8 Quick-add bar and keys.** `QuickAdd.tsx` (A / Cmd+K) taking a line of Proschi; keys Tab, C, F2, T, +/-, R; shortcuts dialog. verify: `canvasEditState.test.ts`; e2e `A`, `cache [Redis]`, Enter. depends on: S6, S3
- [ ] **S9 Docs and tour.** A visual editor docs page (`docs/`, `docs/site.json`), tour steps. verify: `docs.e2e.ts`, `onboarding.e2e.ts`. depends on: S1–S8
- [ ] **Ship.** Full CLAUDE.md checks, PR `feat(editor): …`, merge, watch deploy.
- [ ] **Blog.** Post on the new editor with GIFs and a before/after video; LinkedIn gets one 4-panel image.

## Risks

- `moveStep` (S4) and `renameId` (S6) rewrite text; both need tests over every practice solution.
- S3, S4, S5 all touch `FlowsPanel.tsx`; run them sequentially, not in parallel.
- Changing Flows UI breaks `canvas-parity.e2e.ts:152` and `interview.e2e.ts:327`; update in the same slice.
