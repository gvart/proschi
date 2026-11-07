import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile, the check that the visitor is human, on the email
 * forms (backend src/turnstile.ts verifies the token). Loaded only when the
 * server serves a site key (GET /auth/providers `turnstileSiteKey`), from
 * Cloudflare, which signin/index.html's CSP allows. Tokens work once: the
 * form calls `reset` after each submit.
 */

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')));
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(script);
  });
  return loading;
}

export interface TurnstileHandle {
  reset(): void;
}

/** The widget; `onToken` gets each token, and undefined when one expires. Nothing without a site key. */
export default function Turnstile({
  siteKey,
  action,
  onToken,
  handle,
}: {
  siteKey?: string;
  action: string;
  onToken: (token: string | undefined) => void;
  handle?: React.RefObject<TurnstileHandle | null>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let id: string | undefined;
    let api: TurnstileApi | undefined;
    let gone = false;
    loadTurnstile()
      .then((t) => {
        if (gone || !box.current) return;
        api = t;
        id = t.render(box.current, {
          sitekey: siteKey,
          action,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(undefined),
          'error-callback': () => onTokenRef.current(undefined),
        });
        if (handle) handle.current = { reset: () => id && t.reset(id) };
      })
      .catch(() => onTokenRef.current(undefined));
    return () => {
      gone = true;
      if (api && id) api.remove(id);
    };
  }, [siteKey, action, handle]);

  if (!siteKey) return null;
  return <div ref={box} className="min-h-[65px]" data-testid="turnstile" />;
}
