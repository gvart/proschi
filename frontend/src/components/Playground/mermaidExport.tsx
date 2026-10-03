import type { Diagram } from '../../dsl';
import { toMermaidArchitecture, toMermaidSequence } from '../../dsl/mermaid';
import { MenuItem } from './Menu';

/** What the "Copy Mermaid" items export: the diagram and the selected use case scenario, if any. */
export interface MermaidSource {
  diagram: Diagram;
  useCaseId?: string;
  scenarioId?: string;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('Copy this Mermaid source:', text);
  }
}

/** Export menu entries that copy Mermaid source to the clipboard. */
export function MermaidMenuItems({ source, close }: { source: MermaidSource; close: () => void }) {
  const { diagram, useCaseId, scenarioId } = source;
  return (
    <>
      <div className="my-1 border-t border-gray-100" />
      <MenuItem
        onSelect={() => {
          close();
          copy(toMermaidArchitecture(diagram));
        }}
      >
        Copy Mermaid: architecture
      </MenuItem>
      <MenuItem
        disabled={!useCaseId}
        onSelect={() => {
          close();
          if (useCaseId) copy(toMermaidSequence(diagram, useCaseId, scenarioId));
        }}
      >
        Copy Mermaid: this scenario
      </MenuItem>
    </>
  );
}
