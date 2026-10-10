import { browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { useState } from 'react';
import { setUp, signIn, type Status } from './api';
import { useAction } from './hooks';
import { ErrorNote } from './ui';

/**
 * Before the panel: the first passkey's setup (with the setup token) or the
 * passkey sign-in. There is no username or password.
 */
export default function Gate({ status, onSignedIn }: { status: Status; onSignedIn: () => void }) {
  const action = useAction(onSignedIn);
  const [token, setToken] = useState('');
  const [name, setName] = useState('');

  if (!browserSupportsWebAuthn()) {
    return (
      <GateCard title="Passkeys unavailable">
        <p>This browser doesn't support passkeys. Open the admin panel in a current Chrome, Safari, Firefox or Edge.</p>
      </GateCard>
    );
  }

  if (status.passkeys) {
    return (
      <GateCard title="Admin sign-in">
        <p>Sign in with your admin passkey.</p>
        <ErrorNote>{action.error}</ErrorNote>
        <button type="button" className="ps-btn ps-btn--primary" disabled={action.busy} onClick={() => void action.run(signIn)} autoFocus>
          {action.busy ? 'Waiting for the passkey…' : 'Sign in with passkey'}
        </button>
      </GateCard>
    );
  }

  if (!status.setupAvailable) {
    return (
      <GateCard title="Set up the admin panel">
        <p>No admin passkey yet. To register one, first set a one-time setup token as a secret of the Worker:</p>
        <pre className="adm-pre">cd backend{'\n'}npx wrangler secret put ADMIN_SETUP_TOKEN</pre>
        <p className="adm-muted">Any random string of at least 16 characters, e.g. from `openssl rand -base64 24`. Then reload this page.</p>
      </GateCard>
    );
  }

  return (
    <GateCard title="Set up the admin panel">
      <p>Register the first admin passkey. You need the setup token you set as the ADMIN_SETUP_TOKEN secret; it works only until this passkey exists.</p>
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(() => setUp(token.trim(), name.trim() || 'Passkey'));
        }}
      >
        <label>
          <span>Setup token</span>
          <input className="adm-input" type="password" autoComplete="off" required minLength={16} value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <label>
          <span>Name for this passkey</span>
          <input className="adm-input" placeholder="e.g. MacBook Touch ID" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <ErrorNote>{action.error}</ErrorNote>
        <button type="submit" className="ps-btn ps-btn--primary" disabled={action.busy}>
          {action.busy ? 'Waiting for the passkey…' : 'Create passkey'}
        </button>
      </form>
      <p className="adm-muted">Afterwards, remove the secret (npx wrangler secret delete ADMIN_SETUP_TOKEN) and add a second passkey as a backup.</p>
    </GateCard>
  );
}

function GateCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="adm-gate">
      <div className="ps-card adm-gate__card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
