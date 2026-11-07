import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Row, switchInput } from './settingsUi';

/**
 * The "Product news" switch of Settings › Notifications (backend/src/campaigns.ts
 * GET/PUT /api/me/news): rare emails about new features, on unless turned
 * off here or with the link in one of them, and the address they go to (the
 * email sign-in address, else the one GitHub or Google verified).
 * docs/PRIVACY.md "Product news" says what is stored.
 */

interface News {
  on: boolean;
  email: string | null;
  source: 'email' | 'github' | 'google' | null;
}

const SOURCE = { email: 'your sign-in address', github: 'the address GitHub verified', google: 'the address Google verified' } as const;

export default function ProductNews() {
  const [news, setNews] = useState<News>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    api<News>('/api/me/news').then(
      (n) => live && setNews(n),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  if (!news) return null;

  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      setNews(await api<News>('/api/me/news', { method: 'PUT', body: { on } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label="Product news"
      htmlFor="product-news"
      inline
      help={
        <>
          {news.email && news.source ? (
            <>
              A few emails a year about new features, to {SOURCE[news.source]}, <strong className="break-all font-semibold text-ink">{news.email}</strong>. Each has a one-click link to stop them.
            </>
          ) : (
            'A few emails a year about new features. Your account has no confirmed address for them yet: one comes with your next GitHub or Google sign-in, or a confirmed email sign-in.'
          )}
          {error && (
            <span role="alert" className="mt-1 block font-semibold text-ink">
              {error}
            </span>
          )}
        </>
      }
      control={<input id="product-news" type="checkbox" role="switch" checked={news.on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} className={switchInput} />}
    />
  );
}
