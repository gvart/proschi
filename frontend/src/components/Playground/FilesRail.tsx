import { FilePlus, PanelLeftOpen, Search } from 'lucide-react';
import { CloudIcon } from './CloudStatus';
import { MOD_KEY } from './modKey';

/** The folded diagrams sidebar: open it, jump to a diagram (Ctrl/Cmd+P), start one, and the open diagram's name. */
export default function FilesRail({ title, cloud, onShow, onQuickOpen, onCreate }: { title: string; cloud: { state: Parameters<typeof CloudIcon>[0]['state'] }; onShow: () => void; onQuickOpen: () => void; onCreate: () => void }) {
  const rail = 'p-1.5 rounded-sm text-muted hover:text-ink hover:bg-ink/10';
  return (
    <nav aria-label="Diagrams rail" className="max-md:hidden shrink-0 flex w-10 flex-col items-center gap-1 border-r-bw-1 border-ink bg-surface py-2">
      <button type="button" aria-label="Show sidebar" title="Show the diagrams" onClick={onShow} className={rail}>
        <PanelLeftOpen size={16} />
      </button>
      <button type="button" aria-label="Go to diagram" title={`Go to diagram (${MOD_KEY}+P)`} onClick={onQuickOpen} className={rail}>
        <Search size={16} />
      </button>
      <button type="button" aria-label="New diagram" title="New diagram" onClick={onCreate} className={rail}>
        <FilePlus size={16} />
      </button>
      <span className="my-1 h-px w-5 bg-ink/15" aria-hidden="true" />
      <CloudIcon state={cloud.state} />
      <button
        type="button"
        onClick={onShow}
        title={title}
        aria-label={`Open diagram: ${title}`}
        className="mt-1 min-h-0 flex-1 overflow-hidden rounded-sm px-1 py-1.5 text-xs font-semibold text-ink/75 hover:bg-ink/10 hover:text-ink"
      >
        <span className="block max-h-full truncate [writing-mode:vertical-rl] rotate-180">{title}</span>
      </button>
    </nav>
  );
}
