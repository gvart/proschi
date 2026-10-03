/**
 * The one place the tooling reaches into the editor's source. The parser in
 * frontend/src/dsl is the definition of the language; everything here is a
 * thin adapter around it, so the CLI, the language server and the web editor
 * can never disagree about what is valid.
 */
export { parse } from '../../frontend/src/dsl/parser';
export { addConnection } from '../../frontend/src/dsl/edit';
export { format } from '../../frontend/src/dsl/format';
export { examples } from '../../frontend/src/dsl/examples';
export { componentCatalog } from '../../frontend/src/catalog/componentCatalog';
export type { Diagnostic, Diagram, DiagramNode, DiagramStep, DiagramUseCase, ParseResult, SourceLoc } from '../../frontend/src/dsl/types';

/** Keywords that start a statement, with a one-line hint for completion lists. */
export const KEYWORDS: { label: string; detail: string; snippet: string }[] = [
  { label: 'title', detail: 'Document title', snippet: 'title "$1"' },
  { label: 'group', detail: 'group id "Name" [Style] { … }', snippet: 'group ${1:id} "${2:Name}" {\n\t$0\n}' },
  { label: 'usecase', detail: 'usecase "Name" { steps }', snippet: 'usecase "${1:Name}" {\n\t$0\n}' },
  { label: 'par', detail: 'Steps that run in parallel', snippet: 'par {\n\t$0\n}' },
  { label: 'alt', detail: 'One scenario of a use case', snippet: 'alt "${1:Scenario}" {\n\t$0\n}' },
];
