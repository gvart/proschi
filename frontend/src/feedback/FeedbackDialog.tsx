import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { Bug, CircleCheck, CircleHelp, ImagePlus, Lightbulb, LogIn, MessageSquare, Send, X } from 'lucide-react';
import { field, outlineButton, primaryButton } from '../components/Playground/ui';
import { PROVIDER_LABEL } from '../practice/account';
import { api, ApiError, loginUrl, type Me, type ProviderId } from '../services/api';
import { sendFeedback } from './api';
import { collectContext, describeBrowser, formatSize, KINDS, MAX_DIAGRAM, MAX_FILES, MAX_MESSAGE, MAX_SUBJECT, screenshotProblem, type Kind } from './context';
import { currentDiagram } from './diagram';

const KIND_ICON = { bug: Bug, question: CircleHelp, proposal: Lightbulb, other: MessageSquare } as const;

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', max: 'Max' };

type Account = { status: 'loading' } | { status: 'signed-in'; plan: string } | { status: 'signed-out'; providers: ProviderId[] } | { status: 'error'; error: string };

interface Shot {
  file: File;
  /** A data: URL for the thumbnail (every page's policy allows data: images). */
  preview: string;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function useAccount(): Account {
  const [account, setAccount] = useState<Account>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    api<Me>('/api/me').then(
      (me) => live && setAccount({ status: 'signed-in', plan: me.user.plan ?? 'free' }),
      async (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 401) {
          const { providers } = await api<{ providers: ProviderId[] }>('/auth/providers').catch(() => ({ providers: [] as ProviderId[] }));
          if (live) setAccount({ status: 'signed-out', providers });
        } else setAccount({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return account;
}

/**
 * The one feedback dialog (opened by openFeedback, src/feedback/open.tsx):
 * the type, an optional subject, the message, screenshots and, where the
 * page has one, the diagram; the context sent with it is listed before
 * sending. Signed out, it asks to sign in first.
 */
export default function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const account = useAccount();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current.close()}
      className="m-auto w-[min(34rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-brutal border-bw-1 border-ink bg-surface p-0 text-ink shadow-brutal-lg backdrop:bg-ink/40"
    >
      <div className="flex items-start gap-3 border-b-bw-1 border-ink/15 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-lg font-bold">
            {sent ? 'Message sent' : 'Send feedback'}
          </h2>
          {!sent && <p className="mt-0.5 text-sm text-muted">A bug, a question or an idea: it goes straight to the people who make Proschi.</p>}
        </div>
        <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="-m-1 rounded-sm p-1 text-muted hover:bg-ink/10 hover:text-ink">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {sent ? (
        <ThankYou onClose={() => ref.current?.close()} />
      ) : account.status === 'signed-in' ? (
        <Form plan={account.plan} onSent={() => setSent(true)} onCancel={() => ref.current?.close()} />
      ) : account.status === 'signed-out' ? (
        <SignIn providers={account.providers} />
      ) : account.status === 'error' ? (
        <p role="alert" className="px-5 py-6 text-sm text-red-700 dark:text-red-300">
          {account.error}
        </p>
      ) : (
        <div role="status" aria-label="Loading…" className="space-y-3 px-5 py-6">
          {[80, 100, 60].map((w) => (
            <span key={w} className="block h-4 animate-pulse rounded-sm bg-ink/10" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </dialog>
  );
}

function ThankYou({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div className="flex flex-col items-center px-5 py-8 text-center">
      <CircleCheck size={32} className="text-green-700 dark:text-green-300" aria-hidden="true" />
      <p className="mt-3 font-semibold">Thank you for writing.</p>
      <p className="mt-1 max-w-[40ch] text-sm text-muted">We read every message. If it needs an answer and your account has an email address, we reply there.</p>
      <button ref={closeRef} type="button" onClick={onClose} className={`${outlineButton} mt-5`}>
        Close
      </button>
    </div>
  );
}

function SignIn({ providers }: { providers: ProviderId[] }) {
  const { pathname, search, hash } = window.location;
  return (
    <div className="px-5 py-6">
      <p className="font-semibold">Sign in to send feedback</p>
      <p className="mt-1 text-sm text-muted">So we know who wrote and can follow up. You come back to this page afterwards.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {providers.length ? (
          providers.map((p) => (
            <a key={p} href={loginUrl(p, `${pathname}${search}${hash}`)} className={primaryButton}>
              <LogIn size={14} aria-hidden="true" />
              Sign in with {PROVIDER_LABEL[p] ?? p}
            </a>
          ))
        ) : (
          <p className="text-sm text-muted">Sign-in is not available right now.</p>
        )}
      </div>
    </div>
  );
}

function Form({ plan, onSent, onCancel }: { plan: string; onSent: () => void; onCancel: () => void }) {
  const ids = useId();
  const [kind, setKind] = useState<Kind>('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotError, setShotError] = useState<string>();
  const diagram = currentDiagram();
  const diagramFits = diagram !== undefined && diagram.trim() !== '' && new Blob([diagram]).size <= MAX_DIAGRAM;
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [context] = useState(collectContext);

  useEffect(() => messageRef.current?.focus(), []);

  const addFiles = async (files: File[]) => {
    setShotError(undefined);
    let next = shots;
    for (const file of files) {
      const problem = screenshotProblem(file, next.length);
      if (problem) {
        setShotError(problem);
        break;
      }
      next = [...next, { file, preview: await readAsDataUrl(file) }];
    }
    setShots(next);
  };

  const onPaste = (e: ClipboardEvent) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    e.preventDefault();
    void addFiles(images);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Write a message first.');
      messageRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await sendFeedback({ kind, subject: subject.trim(), message: message.trim(), context, diagram: attach && diagramFits ? diagram : undefined, screenshots: shots.map((s) => s.file) });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const left = MAX_MESSAGE - message.length;
  return (
    <form onSubmit={(e) => void submit(e)} onPaste={onPaste} className="space-y-4 px-5 pt-4" noValidate>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">What is it about?</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {KINDS.map(({ id, label }) => {
            const Icon = KIND_ICON[id];
            return (
              <label
                key={id}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-sm border-bw-1 border-ink/25 bg-surface px-2 py-2 text-sm font-semibold text-ink/80 hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-pop-yellow has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
              >
                <input type="radio" name="kind" value={id} checked={kind === id} onChange={() => setKind(id)} className="sr-only" />
                <Icon size={14} aria-hidden="true" />
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-subject`} className="text-sm font-semibold">
          Subject <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id={`${ids}-subject`} type="text" maxLength={MAX_SUBJECT} value={subject} onChange={(e) => setSubject(e.target.value)} className={`${field} mt-1 w-full`} />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={`${ids}-message`} className="text-sm font-semibold">
            Message
          </label>
          <span className={`text-xs tabular-nums ${left < 200 ? 'text-ink' : 'text-muted'}`} aria-live="polite">
            {left < 500 ? `${left.toLocaleString('en')} characters left` : ''}
          </span>
        </div>
        <textarea
          id={`${ids}-message`}
          ref={messageRef}
          required
          rows={6}
          maxLength={MAX_MESSAGE}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            kind === 'bug' ? 'What happened, and what did you expect? Steps to reproduce help a lot.' : kind === 'proposal' ? 'What would you like, and what would it help you do?' : ''
          }
          className={`${field} mt-1 block w-full resize-y leading-relaxed`}
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={outlineButton} disabled={shots.length >= MAX_FILES} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={14} aria-hidden="true" />
            Add screenshot
          </button>
          <span className="text-xs text-muted">Up to {MAX_FILES} · PNG, JPEG or WebP · 5 MB each · or paste one</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            hidden
            aria-label="Screenshots"
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
        {shotError && (
          <p role="alert" className="mt-1.5 text-xs text-red-700 dark:text-red-300">
            {shotError}
          </p>
        )}
        {shots.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Screenshots to send">
            {shots.map((s, i) => (
              <li key={i} className="relative">
                <img src={s.preview} alt={s.file.name} className="h-16 w-24 rounded-sm border-bw-1 border-ink/25 object-cover" />
                <span className="mt-0.5 block text-[11px] tabular-nums text-muted">{formatSize(s.file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${s.file.name}`}
                  onClick={() => setShots(shots.filter((_, j) => j !== i))}
                  className="absolute -right-2 -top-2 rounded-full border-bw-1 border-ink bg-surface p-0.5 text-ink hover:bg-pop-yellow hover:text-on-accent"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {diagram !== undefined && (
        <label className={`flex items-start gap-2 text-sm ${diagramFits ? 'cursor-pointer' : 'text-muted'}`}>
          <input type="checkbox" checked={attach} disabled={!diagramFits} onChange={(e) => setAttach(e.target.checked)} className="mt-0.5 h-4 w-4 accent-current" />
          <span>
            Attach my current diagram
            <span className="block text-xs text-muted">{diagramFits ? 'Its source text, so we can see what you see.' : 'Too large to attach (over 64 KB).'}</span>
          </span>
        </label>
      )}

      <details className="rounded-sm border-bw-1 border-ink/15 bg-paper px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer font-semibold text-ink/80">Sent with your message: this page, your browser, window size and plan</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>Page</dt>
          <dd className="break-all font-mono text-ink/80">{context.path || '/'}</dd>
          <dt>Browser</dt>
          <dd className="text-ink/80" title={context.userAgent}>
            {describeBrowser(context.userAgent)}
          </dd>
          <dt>Window</dt>
          <dd className="font-mono tabular-nums text-ink/80">{context.viewport}</dd>
          <dt>Plan</dt>
          <dd className="text-ink/80">{PLAN_LABEL[plan] ?? plan}</dd>
          <dt>Version</dt>
          <dd className="text-ink/80">the site's current version</dd>
        </dl>
        <p className="mt-2">Your account is attached so we can reply. Messages are private and part of Download my data.</p>
      </details>

      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t-bw-1 border-ink/15 bg-surface px-5 py-3">
        <button type="button" className={outlineButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButton} disabled={busy}>
          <Send size={14} aria-hidden="true" />
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
