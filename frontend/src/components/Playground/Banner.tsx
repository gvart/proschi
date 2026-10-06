import { X } from 'lucide-react';

export interface BannerMessage {
  message: string;
  tone?: 'info' | 'warning';
  action?: { label: string; run: () => void };
  /** A second choice, e.g. the "no" of a question. */
  secondary?: { label: string; run: () => void };
}

/** A dismissible notice under the header: long share links, backup results, links that could not be opened. */
export default function Banner({ banner, onClose }: { banner: BannerMessage; onClose: () => void }) {
  const warning = banner.tone === 'warning';
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 text-sm border-b ${warning ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100' : 'bg-pop-blue/10 border-pop-blue/30 text-ink'}`}
    >
      <span className="flex-1 min-w-0">{banner.message}</span>
      {banner.action && (
        <button
          type="button"
          onClick={banner.action.run}
          className={`rounded-md border px-2.5 py-1 text-sm font-medium ${warning ? 'border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40' : 'border-pop-blue/40 hover:bg-pop-blue/15'}`}
        >
          {banner.action.label}
        </button>
      )}
      {banner.secondary && (
        <button type="button" onClick={banner.secondary.run} className="rounded-md px-2.5 py-1 text-sm font-medium hover:bg-ink/10">
          {banner.secondary.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={onClose} className="rounded p-1 hover:bg-ink/10">
        <X size={14} />
      </button>
    </div>
  );
}
