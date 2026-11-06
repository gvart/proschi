import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Sparkles, Unlink, X } from 'lucide-react';
import { ApiError } from '../../services/api';
import { UPGRADE_PATH, billingEnabled, createLiveShare, getLiveShare, revokeLiveShare, type LiveShare } from '../../services/documentShares';
import { field, outlineButton, primaryButton } from './ui';

interface ShareLinkDialogProps {
  docId: string;
  title: string;
  /** The account is on Pro, which live share links need. */
  pro: boolean;
  /** Why this diagram cannot have a link yet (it is not in the account), with what to do; null when it can. */
  hint: { message: string; actions: { label: string; run: () => void }[] } | null;
  /** The account's version of the diagram once its edits are pushed; null when it is not in the account. */
  pushedVersion: (id: string) => Promise<number | null>;
  onClose: () => void;
}

const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 402) return 'Live share links are part of Pro.';
    if (e.status === 404) return 'This diagram is not in your account yet; wait for it to sync, then try again.';
    if (e.status === 401) return 'Your session expired; sign in again.';
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * The current diagram's live share link (backend/README.md "Live share
 * links"): make one, copy it, or revoke it. Pro only; without Pro the dialog
 * says so, with an upgrade link when paid plans are on (VITE_BILLING).
 */
export default function ShareLinkDialog({ docId, title, pro, hint, pushedVersion, onClose }: ShareLinkDialogProps) {
  const ready = pro && !hint;
  const [share, setShare] = useState<LiveShare | null | undefined>(ready ? undefined : null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getLiveShare(docId).then(
      (answer) => !cancelled && setShare(answer),
      (e: unknown) => {
        if (cancelled) return;
        setShare(null);
        setError(errorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [docId, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      // The link shows what the account has: push this browser's edits first.
      if ((await pushedVersion(docId)) === null) throw new ApiError(404, 'not synced');
      setShare(await createLiveShare(docId));
    });

  const revoke = () => {
    if (!window.confirm(`Revoke the share link to "${title}"? It stops working at once for everyone who has it.`)) return;
    void run(async () => {
      await revokeLiveShare(docId);
      setShare(null);
    });
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this share link:', url);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Share link"
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-brutal border-bw-2 border-ink bg-surface text-ink shadow-brutal-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b-bw-2 border-ink">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">Share link</h2>
            <p className="text-sm text-muted">
              A live, revocable link to <span className="font-semibold text-ink">{title}</span>. Anyone who has it sees the diagram read-only, as you last saved it, and can run its simulation.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-muted hover:bg-ink/10">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-4 p-5 text-sm">
          {!pro ? (
            <div className="grid gap-3">
              <p>
                Live share links are part of <span className="font-semibold">Pro</span>. Share → Short link still gives anyone a snapshot of the diagram as it is now.
              </p>
              {billingEnabled && (
                <a className={`${primaryButton} justify-self-start`} href={`../${UPGRADE_PATH}`}>
                  <Sparkles size={16} />
                  <span>See Pro</span>
                </a>
              )}
            </div>
          ) : hint ? (
            <div className="grid gap-3">
              <p>{hint.message}</p>
              {hint.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {hint.actions.map((a) => (
                    <button key={a.label} type="button" className={outlineButton} onClick={a.run}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : share === undefined ? (
            <p className="text-muted">Loading…</p>
          ) : share ? (
            <div className="grid gap-3">
              <div className="flex gap-2">
                <input aria-label="Share link" readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} className={`${field} min-w-0 flex-1 font-mono`} />
                <button type="button" className={primaryButton} onClick={() => void copy(share.url)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-xs text-muted">Made on {dateOf(share.createdAt)}. Later saves show at the same link.</p>
              <div className="flex flex-wrap gap-2">
                <a className={outlineButton} href={share.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={16} />
                  <span>Open</span>
                </a>
                <button type="button" className={outlineButton} disabled={busy} onClick={revoke}>
                  <Unlink size={16} />
                  <span>Revoke link</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <p>No link yet. Revoking a link later stops it at once; sharing again makes a new one.</p>
              <button type="button" className={`${primaryButton} justify-self-start`} disabled={busy} onClick={() => void create()}>
                <Link2 size={16} />
                <span>{busy ? 'Making the link…' : 'Create share link'}</span>
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-fail">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
