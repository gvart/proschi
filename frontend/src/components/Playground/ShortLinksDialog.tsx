import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Trash2, X } from 'lucide-react';
import { deleteShare, listShares, type ShareListing } from '../../services/shares';

interface ShortLinksDialogProps {
  onClose: () => void;
  /** A short link was deleted, so the editor stops reusing it. */
  onDeleted: (id: string) => void;
}

const dateOf = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** The signed-in user's short links (GET /api/me/shares): copy or delete each. */
export default function ShortLinksDialog({ onClose, onDeleted }: ShortLinksDialogProps) {
  const [listing, setListing] = useState<ShareListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listShares().then(
      (answer) => !cancelled && setListing(answer),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remove = async (id: string, title: string) => {
    if (!window.confirm(`Delete the short link to "${title}"? It stops working for everyone who has it.`)) return;
    try {
      await deleteShare(id);
      onDeleted(id);
      setListing((l) => (l ? { ...l, shares: l.shares.filter((s) => s.id !== id) } : l));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Your short links"
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b-bw-2 border-ink">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">Your short links</h2>
            <p className="text-sm text-muted">Anyone with a link can open its diagram. Deleting one stops it working.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">
          {error && <p className="mb-3 text-sm text-fail">{error}</p>}
          {!listing && !error && <p className="text-sm text-muted">Loading…</p>}
          {listing && listing.shares.length === 0 && <p className="text-sm text-muted">No short links yet. Share → Short link with preview makes one.</p>}
          {listing && listing.shares.length > 0 && (
            <ul className="divide-y divide-ink/15">
              {listing.shares.map((share) => (
                <li key={share.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{share.title}</div>
                    <div className="font-mono text-xs text-muted">
                      {share.url.replace(/^https?:\/\//, '')} · {dateOf(share.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Copy the link to ${share.title}`}
                    className="p-1.5 rounded-md hover:bg-ink/10"
                    onClick={() => void navigator.clipboard.writeText(share.url).catch(() => window.prompt('Copy this short link:', share.url))}
                  >
                    <Copy size={16} />
                  </button>
                  <a aria-label={`Open ${share.title}`} className="p-1.5 rounded-md hover:bg-ink/10" href={share.url} target="_blank" rel="noopener">
                    <ExternalLink size={16} />
                  </a>
                  <button type="button" aria-label={`Delete the link to ${share.title}`} className="p-1.5 rounded-md hover:bg-ink/10" onClick={() => void remove(share.id, share.title)}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {listing && (
            <p className="mt-3 text-xs text-muted">
              {listing.shares.length} of {listing.max} short links.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
