import type { Diagram } from '../../dsl';
import { toMermaidArchitecture, toMermaidSequence } from '../../dsl/mermaid';
import { track } from '../../services/metrics';
import { downloadText, fileNameFor } from './exportDiagram';
import { MenuItem } from './Menu';

/** What the Mermaid items export: the diagram and the selected use case scenario, if any. */
export interface MermaidSource {
  diagram: Diagram;
  useCaseId?: string;
  scenarioId?: string;
}

async function copy(text: string) {
  track('export');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('Copy this Mermaid source:', text);
  }
}

/** Export menu entries that copy Mermaid source to the clipboard, or download the architecture as a .mmd file. */
export function MermaidMenuItems({ source, close }: { source: MermaidSource; close: () => void }) {
  const { diagram, useCaseId, scenarioId } = source;
  return (
    <>
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
      <MenuItem
        onSelect={() => {
          close();
          downloadText(toMermaidArchitecture(diagram), fileNameFor(diagram.title, 'mmd'));
        }}
      >
        Download Mermaid (.mmd)
      </MenuItem>
    </>
  );
}
