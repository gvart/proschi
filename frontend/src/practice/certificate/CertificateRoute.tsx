import { useEffect, useState } from 'react';
import { BadgeCheck, ExternalLink, Printer, RotateCcw } from 'lucide-react';
import { FaLinkedin } from 'react-icons/fa6';
import PaneLoading from '../../components/PaneLoading';
import ShareButton from '../../components/ShareButton';
import { outlineButton, primaryButton, toolButton } from '../../components/Playground/ui';
import { certificateUrl, linkedInAddUrl } from '../../learn/certificate';
import { ApiError } from '../../services/api';
import { getCertificate, getMyCertificate, type PublicCertificate } from '../../services/certificates';
import './certificate.css';

/**
 * A mastery certificate (`#/c/<id>`, served at /c/<id> with its link
 * preview by the Worker's src/certificates.ts; Max, docs/design/paid-plans.md
 * P56): the owner's level, mastery per skill and problems solved, read from
 * the server at each visit, so what it says is what the account has done.
 * A sheet that prints on one landscape page; its owner also gets "Add to
 * LinkedIn". Off, or no such id, reads as "not found", as the API answers.
 */

type Load = { status: 'loading' } | { status: 'ready'; cert: PublicCertificate } | { status: 'missing' } | { status: 'error'; message: string };

const DATE = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (seconds: number) => DATE.format(new Date(seconds * 1000));
const pct = (share: number) => `${Math.round(share * 100)}%`;

export default function CertificateRoute({ id, signedIn }: { id: string; signedIn: boolean }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [own, setOwn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    getCertificate(id).then(
      (cert) => !cancelled && setLoad({ status: 'ready', cert }),
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

  // The owner's own certificate gets "Add to LinkedIn"; the public answer never names its owner.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    getMyCertificate().then(
      (mine) => live && setOwn(mine?.id === id),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signedIn, id]);

  const name = load.status === 'ready' ? load.cert.displayName : undefined;
  useEffect(() => {
    document.title = name ? `${name}: mastery certificate · Proschi` : 'Mastery certificate · Proschi';
  }, [name]);

  useEffect(() => {
    document.body.classList.add('printing-certificate');
    return () => document.body.classList.remove('printing-certificate');
  }, []);

  if (load.status === 'loading') return <PaneLoading label="Loading the certificate…" />;
  if (load.status !== 'ready') {
    return (
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-14">
        <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">
          {load.status === 'missing' ? 'No certificate here' : 'Could not load this certificate'}
        </h1>
        {load.status === 'missing' ? (
          <p className="mt-3 max-w-2xl text-base text-ink/80">Its owner turned it off, or there is no such certificate.</p>
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

  const { cert } = load;
  const url = certificateUrl(window.location.origin, cert.id);
  return (
    <main className="max-w-5xl mx-auto px-4 py-6 sm:py-10">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className={primaryButton}>
          <Printer size={14} aria-hidden="true" />
          Print or save as PDF
        </button>
        {own && (
          <a href={linkedInAddUrl(cert, url)} target="_blank" rel="noopener noreferrer" className={outlineButton}>
            <FaLinkedin size={14} aria-hidden="true" />
            Add to LinkedIn
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        <ShareButton label="Share" text={`${cert.displayName}'s system design mastery certificate on Proschi: ${url}`} />
      </div>

      <article aria-label={`Mastery certificate of ${cert.displayName}`} className="certificate-sheet ps-light bg-white px-5 py-8 text-ink sm:px-12 sm:py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="font-display text-sm font-extrabold uppercase tracking-[0.18em] text-[#C2410C]">Proschi · Mastery certificate</p>
          <p className="inline-flex items-baseline gap-2 border-bw-2 border-ink px-3 py-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Level</span>
            <span data-testid="certificate-level" className="font-display text-3xl font-extrabold leading-none">
              {cert.level}
            </span>
          </p>
        </div>

        <p className="mt-8 text-sm text-muted">This certifies that</p>
        <h1 className="mt-1 break-words font-display text-[clamp(2.25rem,7vw,4rem)] font-extrabold leading-[1.02] tracking-[-0.02em]">{cert.displayName}</h1>
        <p className="mt-3 max-w-2xl text-base">
          has practised system design on Proschi, where every design is checked by simulation for load, latency, availability and cost, and reached the
          mastery below.
        </p>

        <dl className="mt-8 grid grid-cols-2 border-bw-2 border-ink sm:grid-cols-4">
          {[
            ['Experience', `${cert.xp.toLocaleString('en-US')} XP`],
            ['Problems solved', `${cert.solved.length}/${cert.problems}`],
            ['Interview ready', pct(cert.readiness)],
            ['Longest streak', `${cert.streak.longest} ${cert.streak.longest === 1 ? 'day' : 'days'}`],
          ].map(([label, value], i) => (
            <div key={label} className={`p-3 sm:p-4 ${i % 2 ? 'border-l-bw-2 border-ink' : ''} ${i >= 2 ? 'border-t-bw-2 border-ink sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l-bw-2' : ''}`}>
              <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">{label}</dt>
              <dd className="mt-1 font-display text-2xl font-extrabold sm:text-3xl">{value}</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-8 font-display text-lg font-bold">Mastery per skill</h2>
        <ul className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {cert.skills.map((s) => (
            <li key={s.topic} className="text-sm">
              <span className="flex justify-between gap-2">
                <span>{s.title}</span>
                <span className="font-semibold tabular-nums">{pct(s.mastery)}</span>
              </span>
              <span className="mt-1 block h-2 border border-ink" aria-hidden="true">
                <span className="block h-full bg-[#C2410C]" style={{ width: pct(Math.min(1, Math.max(0, s.mastery))) }} />
              </span>
            </li>
          ))}
        </ul>

        {cert.solved.length > 0 && (
          <>
            <h2 className="mt-8 font-display text-lg font-bold">Problems solved</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {cert.solved.map((p) => (
                <li key={p.id} className="rounded-sm border border-ink/40 px-2 py-0.5 text-xs">
                  {p.title}
                </li>
              ))}
            </ul>
          </>
        )}

        <footer className="mt-10 flex flex-wrap items-end justify-between gap-3 border-t border-ink/30 pt-4 text-xs text-muted">
          <p>
            Issued {day(cert.issuedAt)} · Figures as of {day(cert.asOf)}
            <br />
            Certificate ID <span className="font-mono text-ink">{cert.id}</span>
          </p>
          <p className="inline-flex items-center gap-1.5">
            <BadgeCheck size={14} aria-hidden="true" />
            Verify at <span className="font-mono text-ink">{url.replace(/^https?:\/\//, '')}</span>
          </p>
        </footer>
      </article>
    </main>
  );
}
