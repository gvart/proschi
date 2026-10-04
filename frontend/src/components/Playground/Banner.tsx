import { X } from 'lucide-react';

export interface BannerMessage {
  message: string;
  tone?: 'info' | 'warning';
  action?: { label: string; run: () => void };
}

/** A dismissible notice under the header: long share links, backup results, links that could not be opened. */
export default function Banner({ banner, onClose }: { banner: BannerMessage; onClose: () => void }) {
  const warning = banner.tone === 'warning';
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-4 py-2 text-sm border-b ${warning ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-blue-50 border-blue-200 text-blue-900'}`}
    >
      <span className="flex-1 min-w-0">{banner.message}</span>
      {banner.action && (
        <button
          type="button"
          onClick={banner.action.run}
          className={`rounded-md border px-2.5 py-1 text-sm font-medium ${warning ? 'border-amber-300 hover:bg-amber-100' : 'border-blue-300 hover:bg-blue-100'}`}
        >
          {banner.action.label}
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={onClose} className="rounded p-1 hover:bg-black/5">
        <X size={14} />
      </button>
    </div>
  );
}
