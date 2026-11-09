import { formatDateTime } from './format';
import { useLoad } from './hooks';
import { getUserSignIn, METHOD_LABEL, REASON_LABEL } from './signups';
import { ErrorNote, Section, Skeleton, Stat } from './ui';

/** The account's sign-in methods, whether its address is confirmed, and why it did or didn't get the free sign-up credits. */
export default function UserSignIn({ id, onSignedOut }: { id: string; onSignedOut: () => void }) {
  const { data, error } = useLoad(() => getUserSignIn(id), [id], onSignedOut);
  return (
    <Section title="Sign-in and sign-up credits">
      <ErrorNote>{error}</ErrorNote>
      {!data ? (
        !error && <Skeleton rows={2} what="sign-in methods" />
      ) : (
        <div className="adm-stats">
          <Stat label="Signs in with" value={data.methods.map((m) => METHOD_LABEL[m] ?? m).join(', ') || '—'} />
          <Stat
            label="Email confirmed"
            value={data.confirmed ? 'Yes' : 'No'}
            tone={data.confirmed ? undefined : 'warn'}
            note={data.confirmedAt ? formatDateTime(data.confirmedAt) : data.methods.includes('email') ? undefined : 'by the provider'}
          />
          <Stat
            label="Sign-up credits"
            value={data.signupCredits ? data.signupCredits.outcome[0].toUpperCase() + data.signupCredits.outcome.slice(1) : 'Before the checks'}
            tone={data.signupCredits?.outcome === 'refused' ? 'fail' : data.signupCredits?.outcome === 'granted' ? 'pass' : undefined}
            note={data.signupCredits ? REASON_LABEL[data.signupCredits.reason] : 'Made before sign-up checks existed'}
          />
        </div>
      )}
    </Section>
  );
}
