import { Gift, Megaphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { eyebrow, iconButton, primaryButton } from '../components/Playground/ui';
import { Markdown, type Values } from './markdown';

/**
 * An announcement from the admin's campaigns (backend/src/campaigns.ts), on
 * a signed-in visit: the newest one not dismissed yet, at most one at a time,
 * with the gift's credits when the campaign gave some. Dismissing it, or
 * following its link, hides it for good (stored per account on the server).
 * Self-contained: it loads its own data and renders nothing without one.
 */

export interface AnnouncementData {
  id: string;
  title: string;
  body: string;
  link: { url: string; label: string } | null;
  credits: number | null;
  values: Values;
}

const fill = (text: string, values: Values) => text.replace(/\{\{\s*(name|credits)\s*\}\}/g, (_, key: keyof Values) => values[key]);

const markdownStyles =
  'text-sm text-ink [&_p]:mt-2 [&_p:first-child]:mt-0 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-sm [&_code]:bg-paper [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_.ann-md-heading]:font-display [&_.ann-md-heading]:font-bold';

/** The card itself, also the admin composer's preview. */
export function AnnouncementCard({ data, onDismiss, onClick }: { data: AnnouncementData; onDismiss?: () => void; onClick?: () => void }) {
  return (
    <aside aria-label="Announcement" className="relative rounded-brutal border-bw-1 border-ink bg-surface p-4 shadow-brutal-sm">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-bw-1 border-ink bg-pop-yellow text-on-accent">
          <Megaphone size={16} />
        </span>
        <div className="min-w-0 flex-1 pr-8">
          <p className={eyebrow}>New on Proschi</p>
          <h2 className="mt-0.5 font-display text-lg font-bold leading-snug text-ink">{fill(data.title, data.values)}</h2>
          {data.credits !== null && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border-bw-1 border-ink bg-pop-yellow px-2.5 py-0.5 text-xs font-bold text-on-accent">
              <Gift size={13} aria-hidden="true" />+{data.credits.toLocaleString('en-US')} credits on your account
            </p>
          )}
          <div className={`mt-2 max-w-[65ch] ${markdownStyles}`}>
            <Markdown source={data.body} values={data.values} />
          </div>
          {data.link && (
            <a className={`${primaryButton} mt-3`} href={data.link.url} onClick={onClick}>
              {data.link.label}
            </a>
          )}
        </div>
      </div>
      <button type="button" className={`${iconButton} absolute right-2 top-2`} aria-label="Dismiss announcement" onClick={onDismiss}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}

/** The signed-in user's announcement, if any, under the page header; `onChange` hears whether it is on the page once known, and when it goes. */
export default function Announcement({ onChange }: { onChange?: (shown: boolean) => void }) {
  const [data, setData] = useState<AnnouncementData | null>(null);
  useEffect(() => {
    let live = true;
    api<{ announcement: AnnouncementData | null }>('/api/me/announcement').then(
      (r) => {
        if (!live) return;
        setData(r.announcement);
        onChange?.(r.announcement !== null);
      },
      () => live && onChange?.(false),
    );
    return () => {
      live = false;
    };
    // Once, on mount: the caller's callback is not a reason to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!data) return null;
  const mark = (what: 'dismiss' | 'click') => {
    setData(null);
    onChange?.(false);
    // keepalive: a click leaves the page, and the request must still arrive.
    void fetch(`/api/me/announcement/${encodeURIComponent(data.id)}/${what}`, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  };
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-4">
      <AnnouncementCard data={data} onDismiss={() => mark('dismiss')} onClick={() => mark('click')} />
    </div>
  );
}
