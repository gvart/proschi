import { useEffect, useState } from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import problems from 'virtual:practice-listings';
import PaneLoading from '../../components/PaneLoading';
import { primaryButton, toolButton } from '../../components/Playground/ui';
import { api, ApiError, type PublicProfile } from '../../services/api';
import { ACHIEVEMENTS } from '../achievementList';
import ProfileView from './ProfileView';
import { publicProfile } from './profile';

/**
 * Someone's public profile (`#/u/<id>`), from GET /api/users/<id>/profile:
 * the account page's layout, read only. A user who has not opted in, or no
 * such user, reads as "not found" either way, as the API answers.
 *
 * Loaded lazily with the cards, for the topics' names.
 */

type Load = { status: 'loading' } | { status: 'ready'; profile: PublicProfile } | { status: 'missing' } | { status: 'error'; message: string };

export default function PublicProfileRoute({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) {
      setLoad({ status: 'missing' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    api<PublicProfile>(`/api/users/${encodeURIComponent(id)}/profile`).then(
      (profile) => !cancelled && setLoad({ status: 'ready', profile }),
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setLoad({ status: 'missing' });
        else setLoad({ status: 'error', message: e instanceof ApiError && e.status === 429 ? 'Too many requests; wait a minute and try again.' : 'Could not reach the server; try again.' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  const name = load.status === 'ready' ? load.profile.displayName : undefined;
  useEffect(() => {
    document.title = name ? `${name} · Proschi practice` : 'Profile · Proschi practice';
  }, [name]);

  if (load.status === 'loading') return <PaneLoading label="Loading the profile…" />;
  if (load.status !== 'ready') {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">
          {load.status === 'missing' ? 'No public profile here' : 'Could not load this profile'}
        </h1>
        {load.status === 'missing' ? (
          <p className="mt-3 max-w-2xl text-base text-ink/80">This profile is private, or there is no such user. Profiles are public only when their owner chooses.</p>
        ) : (
          <>
            <p role="alert" className="mt-3 text-sm text-ink">
              {load.message}
            </p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`mt-3 ${primaryButton}`}>
              <RotateCcw size={14} aria-hidden="true" />
              Try again
            </button>
          </>
        )}
        <a href="#/" className={`mt-4 -ml-2.5 ${toolButton}`}>
          All problems
        </a>
      </main>
    );
  }

  return (
    <ProfileView
      model={publicProfile(load.profile, ACHIEVEMENTS, problems)}
      kicker="Public profile"
      note={
        <p role="note" className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border-bw-1 border-ink bg-pop-blue/15 px-3 py-1 text-sm text-ink">
          <Eye size={14} aria-hidden="true" className="flex-shrink-0" />
          This is a public profile: only what {load.profile.displayName} chose to share.
        </p>
      }
    />
  );
}
