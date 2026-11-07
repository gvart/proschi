import { useState, type FormEvent } from 'react';
import { CloudOff, Download, ExternalLink, Link, LogOut, MonitorX, Pencil, Trash2, Unlink } from 'lucide-react';
import ShareButton from '../../components/ShareButton';
import { field, outlineButton, primaryButton } from '../../components/Playground/ui';
import { profileShareText } from '../../learn/share';
import { deleteCloudCopies, removeSyncedFromBrowser, syncedInBrowser } from '../../playground/localDocs';
import type { ProviderId, User } from '../../services/api';
import { announcePlanChanged, billingEnabled } from '../../services/billing';
import { PROVIDER_LABEL } from '../account';
import type { Activity } from '../activity';
import { GoalChoices } from '../Streak';
import type { Account } from '../useAccount';
import { PUBLIC_FIELDS } from './profile';
import { Confirm, dangerButton, Row, Section, switchInput } from './settingsUi';

/**
 * The settings page's sections (`#/me`, AccountRoute.tsx) after Plan &
 * billing, signed in: the profile (display name, the public profile and
 * leaderboard switch with its links), the daily goal, the sign-in methods,
 * the account's data and sessions, and deleting the account in the danger
 * zone. Every destructive action asks first; docs/PRIVACY.md says what each
 * one does.
 */

type SignedIn = Extract<Account['state'], { status: 'signed-in' }>;

const label = (p: ProviderId) => PROVIDER_LABEL[p] ?? p;

export function ProfileSection({ account, user }: { account: Account; user: User }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const saveName = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) void account.update({ displayName: name.trim() });
    setEditing(false);
  };

  return (
    <Section id="profile" title="Profile" description="How you appear on the leaderboard and your public profile.">
      <Row
        label="Display name"
        help={
          editing ? (
            'Shown on the leaderboard if you opt in.'
          ) : (
            <>
              <strong className="font-semibold text-ink">{user.displayName}</strong> · shown on the leaderboard if you opt in.
            </>
          )
        }
        control={
          !editing && (
            <button
              type="button"
              className={outlineButton}
              onClick={() => {
                setName(user.displayName);
                setEditing(true);
              }}
            >
              <Pencil size={14} aria-hidden="true" />
              Change display name
            </button>
          )
        }
      >
        {editing && (
          <form onSubmit={saveName} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              aria-label="Display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className={`${field} w-full sm:w-64`}
              autoFocus
            />
            <button type="submit" className={primaryButton}>
              Save
            </button>
            <button type="button" className={outlineButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        )}
      </Row>
      <Row
        label="Show me on the leaderboard, with a public profile"
        htmlFor="public-profile-switch"
        inline
        help={
          <>
            <p>Anyone can see your name, solved problems, streaks and badges. Turn it off to hide them at once.</p>
            <details className="group mt-1">
              <summary className="cursor-pointer font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink">What’s visible</summary>
              <p className="mt-1">
                When on, anyone can see {PUBLIC_FIELDS}. Your designs, daily goal, review history, sign-ins and sessions always stay private.
              </p>
            </details>
          </>
        }
        control={
          <input
            id="public-profile-switch"
            type="checkbox"
            role="switch"
            checked={user.publicProfile}
            onChange={(e) => void account.update({ publicProfile: e.target.checked })}
            className={switchInput}
          />
        }
      >
        {user.publicProfile && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={`#/u/${user.id}`} className={outlineButton}>
              <ExternalLink size={14} aria-hidden="true" />
              See your public profile
            </a>
            <ShareButton label="Share your profile" text={profileShareText({ displayName: user.displayName, userId: user.id, own: true })} />
          </div>
        )}
      </Row>
    </Section>
  );
}

export function LearningSection({ activity }: { activity: Activity }) {
  const ready = activity.state.status === 'ready' ? activity.state : undefined;
  return (
    <Section id="learning" title="Learning" description="What counts as a day of practice for your streak.">
      <Row
        label="Daily goal"
        labelId="settings-daily-goal"
        help="Cards a day. A solved problem, the daily challenge or an Arcade run meets it too."
        control={
          ready ? (
            <GoalChoices goal={ready.goal} onPick={(n) => void activity.setGoal(n)} labelledBy="settings-daily-goal" />
          ) : (
            <span className="text-sm text-muted">{activity.state.status === 'error' ? 'Could not load your goal.' : 'Loading…'}</span>
          )
        }
      />
    </Section>
  );
}

export function ConnectedAccounts({ account, state }: { account: Account; state: SignedIn }) {
  const [unlinking, setUnlinking] = useState<ProviderId | null>(null);
  const linked = state.user.providers ?? [];
  const all = [...linked, ...state.providers.filter((p) => !linked.includes(p))];
  return (
    <Section
      id="accounts"
      title="Connected accounts"
      description={linked.length ? `You sign in with ${linked.map(label).join(' and ')}. Link another to sign in either way.` : 'No sign-in method is linked.'}
    >
      {all.map((p) => {
        const on = linked.includes(p);
        return (
          <Row
            key={p}
            label={label(p)}
            help={on ? (linked.length >= 2 ? 'Linked: you can sign in with it.' : 'Linked. Your only sign-in method, so it can’t be unlinked.') : 'Not linked.'}
            control={
              !on ? (
                <button type="button" className={outlineButton} onClick={() => account.link(p)}>
                  <Link size={14} aria-hidden="true" />
                  Link {label(p)}
                </button>
              ) : (
                linked.length >= 2 && (
                  <button type="button" className={outlineButton} onClick={() => setUnlinking(p)}>
                    <Unlink size={14} aria-hidden="true" />
                    Unlink {label(p)}
                  </button>
                )
              )
            }
          >
            {unlinking === p && (
              <Confirm
                question={`Stop signing in with ${label(p)}?`}
                yes={`Unlink ${label(p)}`}
                onYes={() => {
                  setUnlinking(null);
                  void account.unlink(p);
                }}
                onCancel={() => setUnlinking(null)}
              />
            )}
          </Row>
        );
      })}
    </Section>
  );
}

export function DataPrivacy({ account, user }: { account: Account; user: User }) {
  const [pending, setPending] = useState<'cloud' | 'everywhere' | null>(null);
  const [cloud, setCloud] = useState<{ busy?: boolean; done?: string; error?: string }>({});
  const synced = syncedInBrowser();
  const removeCloud = () => {
    setCloud({ busy: true });
    deleteCloudCopies(user.id).then(
      () => {
        setCloud({ done: 'Your cloud copies were deleted, and cloud sync is off in this browser. The diagrams here stay.' });
        // Plan & billing counts the diagrams again.
        announcePlanChanged();
      },
      (e: unknown) => setCloud({ error: e instanceof Error ? e.message : String(e) }),
    );
  };

  return (
    <Section id="data" title="Data & privacy" description="Take a copy of your data, remove your synced diagrams, or end your sessions.">
      <Row
        label="Download my data"
        help="Everything stored about you, as JSON: progress, diagrams and their versions, billing and sessions."
        control={
          <button type="button" className={outlineButton} onClick={() => void account.downloadData()}>
            <Download size={14} aria-hidden="true" />
            Download my data
          </button>
        }
      />
      <Row
        label="Cloud copies of your diagrams"
        help="Deletes every diagram saved in your account, with its versions, and turns cloud sync off in this browser. The diagrams in this browser stay."
        control={
          <button type="button" className={dangerButton} disabled={cloud.busy} onClick={() => setPending('cloud')}>
            <CloudOff size={14} aria-hidden="true" />
            Delete my cloud copies
          </button>
        }
      >
        {pending === 'cloud' && (
          <Confirm
            question="Delete every diagram saved in your account?"
            yes="Delete my cloud copies"
            onYes={() => {
              setPending(null);
              removeCloud();
            }}
            onCancel={() => setPending(null)}
          />
        )}
        {cloud.done && (
          <p role="status" className="mt-3 text-sm text-ink">
            {cloud.done}
          </p>
        )}
        {cloud.error && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
            {cloud.error}
          </p>
        )}
      </Row>
      <Row
        label="Sign out"
        help={synced > 0 ? 'Sign out of this browser. Your synced diagrams stay here unless you remove them.' : 'Sign out of this browser.'}
        control={
          <>
            <button type="button" className={outlineButton} onClick={() => void account.signOut()}>
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
            {synced > 0 && (
              <button
                type="button"
                className={outlineButton}
                onClick={() => {
                  removeSyncedFromBrowser();
                  void account.signOut();
                }}
              >
                <LogOut size={14} aria-hidden="true" />
                Sign out and remove synced diagrams from this browser
              </button>
            )}
          </>
        }
      />
      <Row
        label="Sign out everywhere"
        help="Ends every session on every device, apps and the command line tool included, this browser too."
        control={
          <button type="button" className={outlineButton} onClick={() => setPending('everywhere')}>
            <MonitorX size={14} aria-hidden="true" />
            Sign out everywhere
          </button>
        }
      >
        {pending === 'everywhere' && (
          <Confirm
            question="Sign out on every device and browser, this one included?"
            yes="Sign out everywhere"
            onYes={() => {
              setPending(null);
              void account.signOutEverywhere();
            }}
            onCancel={() => setPending(null)}
          />
        )}
      </Row>
    </Section>
  );
}

export function DangerZone({ account }: { account: Account }) {
  const [asking, setAsking] = useState(false);
  return (
    <Section id="danger" title="Danger zone" description="This can’t be undone." danger>
      <Row
        label="Delete account"
        help={
          <>
            Removes your account and the progress stored on the server. Progress kept in this browser stays.
            {billingEnabled && ' A Pro subscription is canceled at once, and unused interview credits are lost.'}
          </>
        }
        control={
          <button type="button" className={dangerButton} onClick={() => setAsking(true)}>
            <Trash2 size={14} aria-hidden="true" />
            Delete account
          </button>
        }
      >
        {asking && (
          <Confirm
            question="Delete your account for good? This cannot be undone."
            yes="Yes, delete my account"
            onYes={() => {
              setAsking(false);
              void account.remove();
            }}
            onCancel={() => setAsking(false)}
          />
        )}
      </Row>
    </Section>
  );
}
