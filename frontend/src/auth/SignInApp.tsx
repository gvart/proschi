import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, CircleCheck, Eye, EyeOff, Info, KeyRound, LogIn, Mail, TriangleAlert } from 'lucide-react';
import Footer from '../design/Footer';
import Header from '../design/Header';
import { eyebrow, field, outlineButton, primaryButton } from '../components/Playground/ui';
import { PROVIDER_LABEL } from '../practice/account';
import { ApiError, apiEnabled, loginUrl, type ProviderId } from '../services/api';
import {
  confirmEmail,
  creditsMessage,
  getProviders,
  getStatus,
  MIN_PASSWORD,
  readPlace,
  requestReset,
  resendConfirmation,
  resetPassword,
  signIn,
  signUp,
  type EmailStatus,
  type SignupCredits,
} from './signin';
import Turnstile, { type TurnstileHandle } from './Turnstile';

/**
 * The sign-in page (/signin/): email and password sign-in and sign-up, the
 * confirmation and password reset links, and GitHub and Google. Every
 * "Sign in with Email" button lands here (GET /auth/email/start). Signed in
 * with an unconfirmed address, it asks for the confirmation, with a resend
 * button. backend/README.md "Email sign-in".
 */

type View =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'signin' | 'signup' | 'forgot' | 'link' }
  | { kind: 'sent'; title: string; text: string }
  | { kind: 'confirm'; token: string }
  | { kind: 'reset'; token: string }
  | { kind: 'account'; status: EmailStatus }
  | { kind: 'done'; title: string; text: string; credits?: SignupCredits | null };

const card = 'w-full max-w-md rounded-brutal border-bw-2 border-ink bg-surface p-5 sm:p-7 shadow-brutal-md';
const place = readPlace(window.location.href);

export default function SignInApp() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [providers, setProviders] = useState<string[]>([]);
  const [siteKey, setSiteKey] = useState<string>();

  useEffect(() => {
    document.title = 'Sign in · Proschi';
    if (!apiEnabled) return setView({ kind: 'off' });
    // The links' token stays out of the address bar once read.
    if (place.confirm || place.reset) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    void (async () => {
      const offered = await getProviders().catch(() => ({ providers: [] as string[], turnstileSiteKey: undefined }));
      setProviders(offered.providers);
      setSiteKey(offered.turnstileSiteKey);
      if (place.confirm) return setView({ kind: 'confirm', token: place.confirm });
      if (place.reset) return setView({ kind: 'reset', token: place.reset });
      if (!offered.providers.includes('email')) return setView({ kind: 'off' });
      const answer = await getStatus().catch(() => undefined);
      const status = answer?.signedIn ? answer : undefined;
      if (status && place.link && !status.email) return setView({ kind: 'link' });
      setView(status ? { kind: 'account', status } : { kind: 'signin' });
    })();
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-paper">
      <Header base="../" />
      <main className="flex-1 w-full px-4 py-8 sm:py-16 flex justify-center items-start">
        <div className={card}>
          <Body view={view} setView={setView} providers={providers} siteKey={siteKey} />
        </div>
      </main>
      <Footer base="../" />
    </div>
  );
}

function Body({ view, setView, providers, siteKey }: { view: View; setView: (v: View) => void; providers: string[]; siteKey?: string }) {
  switch (view.kind) {
    case 'loading':
      return <p className="text-sm text-muted" role="status">Loading…</p>;
    case 'off':
      return (
        <>
          <Title eyebrowText="Sign in">Email sign-in isn't available here</Title>
          <p className="text-sm text-muted">This copy of Proschi has no email sign-in. Your progress is kept in this browser.</p>
          <OAuthButtons providers={providers} />
          <Continue />
        </>
      );
    case 'signin':
    case 'signup':
      return <SignInOrUp key={view.kind} mode={view.kind} setView={setView} providers={providers} siteKey={siteKey} />;
    case 'forgot':
      return <Forgot setView={setView} siteKey={siteKey} />;
    case 'link':
      return <LinkEmail setView={setView} siteKey={siteKey} />;
    case 'sent':
      return (
        <>
          <Title eyebrowText="Check your inbox" icon={<Mail size={22} aria-hidden="true" />}>
            {view.title}
          </Title>
          <p className="text-sm">{view.text}</p>
          <p className="mt-3 text-xs text-muted">Nothing after a few minutes? Check your spam folder, or try again in a minute.</p>
          <button type="button" className={`${outlineButton} mt-5`} onClick={() => setView({ kind: 'signin' })}>
            Back to sign in
          </button>
        </>
      );
    case 'confirm':
      return <Confirm token={view.token} setView={setView} />;
    case 'reset':
      return <Reset token={view.token} setView={setView} />;
    case 'account':
      return <AccountStatus status={view.status} />;
    case 'done':
      return (
        <>
          <Title eyebrowText="Done" icon={<CircleCheck size={22} aria-hidden="true" />}>
            {view.title}
          </Title>
          <p className="text-sm">{view.text}</p>
          <Credits credits={view.credits} />
          <Continue primary />
        </>
      );
  }
}

function Title({ eyebrowText, icon, children }: { eyebrowText: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className={eyebrow}>{eyebrowText}</p>
      <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-ink">
        {icon}
        {children}
      </h1>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'good' | 'info' | 'warn' | 'error'; children: ReactNode }) {
  const style = {
    good: 'bg-pass/15 border-pass',
    info: 'bg-pop-blue/20 border-ink',
    warn: 'bg-pop-yellow/30 border-ink',
    error: 'bg-fail/15 border-fail',
  }[tone];
  const Icon = tone === 'good' ? CircleCheck : tone === 'error' || tone === 'warn' ? TriangleAlert : Info;
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`mt-4 flex gap-2 rounded-sm border-bw-1 px-3 py-2 text-sm text-ink ${style}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Credits({ credits }: { credits?: SignupCredits | null }) {
  const message = creditsMessage(credits);
  return message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
}

function Continue({ primary = false }: { primary?: boolean }) {
  return (
    <a className={`${primary ? primaryButton : outlineButton} mt-5`} href={place.returnTo}>
      Continue
      <ArrowRight size={14} aria-hidden="true" />
    </a>
  );
}

function OAuthButtons({ providers }: { providers: string[] }) {
  const oauth = providers.filter((p) => p !== 'email') as ProviderId[];
  if (!oauth.length) return null;
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-2 text-xs text-muted before:h-px before:flex-1 before:bg-ink/20 after:h-px after:flex-1 after:bg-ink/20">or</p>
      <div className="flex flex-col gap-2">
        {oauth.map((p) => (
          <a key={p} className={`${outlineButton} justify-center`} href={loginUrl(p, place.returnTo)}>
            <LogIn size={14} aria-hidden="true" />
            Continue with {PROVIDER_LABEL[p]}
          </a>
        ))}
      </div>
    </div>
  );
}

const messageOf = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

/** A form's busy state, error, and its Turnstile token (reset after every submit: tokens work once). */
function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [token, setToken] = useState<string>();
  const turnstile = useRef<TurnstileHandle | null>(null);
  const run = async (e: FormEvent, action: () => Promise<void>) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
      turnstile.current?.reset();
      setToken(undefined);
    }
  };
  return { busy, error, token, setToken, turnstile, run };
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">Email</span>
      <input
        className={`${field} mt-1 w-full`}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function PasswordField({ value, onChange, isNew, label = 'Password' }: { value: string; onChange: (v: string) => void; isNew: boolean; label?: string }) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <span className="mt-1 flex gap-1">
        <input
          id={id}
          className={`${field} w-full`}
          type={shown ? 'text' : 'password'}
          name="password"
          autoComplete={isNew ? 'new-password' : 'current-password'}
          required
          minLength={isNew ? MIN_PASSWORD : undefined}
          maxLength={200}
          aria-describedby={isNew ? `${id}-hint` : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className={outlineButton} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown(!shown)}>
          {shown ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
        </button>
      </span>
      {isNew && (
        <span id={`${id}-hint`} className="mt-1 block text-xs text-muted">
          At least {MIN_PASSWORD} characters. A short sentence works well.
        </span>
      )}
    </div>
  );
}

function SignInOrUp({ mode, setView, providers, siteKey }: { mode: 'signin' | 'signup'; setView: (v: View) => void; providers: string[]; siteKey?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm();
  const signup = mode === 'signup';
  const blocked = !!siteKey && !form.token;

  const submit = (e: FormEvent) =>
    form.run(e, async () => {
      if (signup) {
        const { message } = await signUp({ email, password, turnstile: form.token });
        setView({ kind: 'sent', title: 'Confirm your address', text: message });
        return;
      }
      const { confirmed } = await signIn({ email, password, turnstile: form.token });
      if (confirmed) window.location.assign(place.returnTo);
      else setView({ kind: 'account', status: await getStatus() });
    });

  return (
    <>
      <Title eyebrowText={signup ? 'Create an account' : 'Welcome back'}>{signup ? 'Sign up to Proschi' : 'Sign in to Proschi'}</Title>
      <div role="tablist" aria-label="Sign in or sign up" className="mb-4 grid grid-cols-2 rounded-sm border-bw-1 border-ink p-0.5 text-sm font-semibold">
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`rounded-[2px] px-3 py-1.5 ${mode === m ? 'bg-ink text-paper' : 'text-ink hover:bg-ink/10'}`}
            onClick={() => setView({ kind: m })}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <form className="flex flex-col gap-3" onSubmit={submit} aria-label={signup ? 'Create account' : 'Sign in'}>
        <EmailField value={email} onChange={setEmail} />
        <PasswordField value={password} onChange={setPassword} isNew={signup} />
        {!signup && (
          <button type="button" className="self-start text-xs font-semibold text-ink underline underline-offset-2" onClick={() => setView({ kind: 'forgot' })}>
            Forgot your password?
          </button>
        )}
        <Turnstile key={mode} siteKey={siteKey} action={signup ? 'signup' : 'login'} onToken={form.setToken} handle={form.turnstile} />
        {form.error && <Notice tone="error">{form.error}</Notice>}
        <button type="submit" className={`${primaryButton} justify-center`} disabled={form.busy || blocked}>
          {signup ? <Mail size={14} aria-hidden="true" /> : <LogIn size={14} aria-hidden="true" />}
          {form.busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
        </button>
        {signup && (
          <p className="text-xs text-muted">
            We email you a link to confirm the address. New accounts get free sign-up credits once confirmed, one account per person. See the{' '}
            <a className="underline" href="../docs/privacy/">
              privacy policy
            </a>
            .
          </p>
        )}
      </form>
      <OAuthButtons providers={providers} />
    </>
  );
}

function Forgot({ setView, siteKey }: { setView: (v: View) => void; siteKey?: string }) {
  const [email, setEmail] = useState('');
  const form = useForm();
  return (
    <>
      <Title eyebrowText="Password reset" icon={<KeyRound size={22} aria-hidden="true" />}>
        Reset your password
      </Title>
      <p className="mb-4 text-sm text-muted">Enter your account's address and we'll email you a link to set a new password.</p>
      <form
        className="flex flex-col gap-3"
        aria-label="Reset your password"
        onSubmit={(e) =>
          form.run(e, async () => {
            const { message } = await requestReset({ email, turnstile: form.token });
            setView({ kind: 'sent', title: 'Check your inbox', text: message });
          })
        }
      >
        <EmailField value={email} onChange={setEmail} />
        <Turnstile siteKey={siteKey} action="reset" onToken={form.setToken} handle={form.turnstile} />
        {form.error && <Notice tone="error">{form.error}</Notice>}
        <button type="submit" className={`${primaryButton} justify-center`} disabled={form.busy || (!!siteKey && !form.token)}>
          {form.busy ? 'Sending…' : 'Send the reset link'}
        </button>
      </form>
      <button type="button" className={`${outlineButton} mt-4`} onClick={() => setView({ kind: 'signin' })}>
        Back to sign in
      </button>
    </>
  );
}

function LinkEmail({ setView, siteKey }: { setView: (v: View) => void; siteKey?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const form = useForm();
  return (
    <>
      <Title eyebrowText="Settings">Add an email sign-in</Title>
      <p className="mb-4 text-sm text-muted">Sign in to this account with an email address and password too. We email you a link to confirm the address.</p>
      <form
        className="flex flex-col gap-3"
        aria-label="Add an email sign-in"
        onSubmit={(e) =>
          form.run(e, async () => {
            const { message } = await signUp({ email, password, turnstile: form.token, link: true });
            setView({ kind: 'sent', title: 'Confirm your address', text: message });
          })
        }
      >
        <EmailField value={email} onChange={setEmail} />
        <PasswordField value={password} onChange={setPassword} isNew />
        <Turnstile siteKey={siteKey} action="signup" onToken={form.setToken} handle={form.turnstile} />
        {form.error && <Notice tone="error">{form.error}</Notice>}
        <button type="submit" className={`${primaryButton} justify-center`} disabled={form.busy || (!!siteKey && !form.token)}>
          {form.busy ? 'Adding…' : 'Add email sign-in'}
        </button>
      </form>
      <Continue />
    </>
  );
}

function Confirm({ token, setView }: { token: string; setView: (v: View) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <Title eyebrowText="One last step" icon={<Mail size={22} aria-hidden="true" />}>
        Confirm your email
      </Title>
      {/* A button, not on load: mail scanners open links, and must not use up the token. */}
      <p className="text-sm text-muted">Confirm this is your address to finish setting up your Proschi account.</p>
      {error && <Notice tone="error">{error}</Notice>}
      <button
        type="button"
        className={`${primaryButton} mt-5 justify-center`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          confirmEmail(token)
            .then(({ signupCredits }) => setView({ kind: 'done', title: 'Your address is confirmed', text: 'You are signed in.', credits: signupCredits }))
            .catch((e: unknown) => {
              setError(messageOf(e));
              setBusy(false);
            });
        }}
      >
        <CircleCheck size={14} aria-hidden="true" />
        {busy ? 'Confirming…' : 'Confirm my address'}
      </button>
      {error && (
        <button type="button" className={`${outlineButton} mt-3`} onClick={() => setView({ kind: 'signin' })}>
          Go to sign in
        </button>
      )}
    </>
  );
}

function Reset({ token, setView }: { token: string; setView: (v: View) => void }) {
  const [password, setPassword] = useState('');
  const form = useForm();
  return (
    <>
      <Title eyebrowText="Password reset" icon={<KeyRound size={22} aria-hidden="true" />}>
        Set a new password
      </Title>
      <p className="mb-4 text-sm text-muted">This signs you out on every other device.</p>
      <form
        className="flex flex-col gap-3"
        aria-label="Set a new password"
        onSubmit={(e) =>
          form.run(e, async () => {
            await resetPassword(token, password);
            setView({ kind: 'done', title: 'Your password is changed', text: 'You are signed in here, and signed out everywhere else.' });
          })
        }
      >
        <PasswordField value={password} onChange={setPassword} isNew label="New password" />
        {form.error && <Notice tone="error">{form.error}</Notice>}
        <button type="submit" className={`${primaryButton} justify-center`} disabled={form.busy}>
          {form.busy ? 'Saving…' : 'Set the new password'}
        </button>
      </form>
      {form.error && /expired|used/.test(form.error) && (
        <button type="button" className={`${outlineButton} mt-3`} onClick={() => setView({ kind: 'forgot' })}>
          Ask for a new link
        </button>
      )}
    </>
  );
}

function AccountStatus({ status }: { status: EmailStatus }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'good' | 'error' | 'info'; text: string }>();
  if (status.email && !status.confirmed) {
    return (
      <>
        <Title eyebrowText="Signed in" icon={<Mail size={22} aria-hidden="true" />}>
          Confirm your email
        </Title>
        <p className="text-sm">
          We sent a link to <strong className="break-all">{status.email}</strong>. Open it to confirm the address.
        </p>
        <Notice tone="warn">Until you confirm, this account gets no free sign-up credits.</Notice>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              resendConfirmation()
                .then((r) => setNote(r.confirmed ? { tone: 'good', text: 'Your address is already confirmed.' } : { tone: r.sent ? 'good' : 'info', text: r.message ?? 'Sent.' }))
                .catch((e: unknown) => setNote({ tone: 'error', text: messageOf(e) }))
                .finally(() => setBusy(false));
            }}
          >
            <Mail size={14} aria-hidden="true" />
            {busy ? 'Sending…' : 'Resend the link'}
          </button>
          <a className={outlineButton} href={place.returnTo}>
            Continue for now
          </a>
        </div>
      </>
    );
  }
  return (
    <>
      <Title eyebrowText="Signed in" icon={<CircleCheck size={22} aria-hidden="true" />}>
        You're signed in
      </Title>
      {status.email && (
        <p className="text-sm">
          As <strong className="break-all">{status.email}</strong>.
        </p>
      )}
      <Credits credits={status.signupCredits} />
      <Continue primary />
    </>
  );
}
