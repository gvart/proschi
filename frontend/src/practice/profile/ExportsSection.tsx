import { useEffect, useState, type ReactNode } from 'react';
import { Award, Download, ExternalLink, FileSpreadsheet } from 'lucide-react';
import { FaLinkedin } from 'react-icons/fa6';
import ShareButton from '../../components/ShareButton';
import UpgradeHint from '../../components/UpgradeHint';
import { useFeature, type FeatureState } from '../../components/featureState';
import { outlineButton } from '../../components/Playground/ui';
import { downloadBlob } from '../../components/Playground/exportDiagram';
import { certificateUrl, linkedInAddUrl } from '../../learn/certificate';
import { progressCsvFiles } from '../../learn/progressExport';
import { writeZip } from '../../playground/zip';
import { getEmbedBranding, getMyCertificate, getProgressExport, setCertificate, setEmbedBranding, type MyCertificate } from '../../services/certificates';
import { exportsShown, shownRow as shown } from './settingsSections';
import { Row, Section, switchInput } from './settingsUi';

/**
 * Settings › Exports & certificate (docs/design/paid-plans.md P56): the
 * progress export as JSON or CSV (Pro), embeds without Proschi's branding
 * (Pro) and the public mastery certificate (Max). A row the plan lacks shows
 * the way to the plan where paid plans are on, and is left out where they
 * are off (P53), and the section with it when no row is left.
 */

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ExportsSection() {
  const data = useFeature('data_export');
  const pro = useFeature('pro_exports');
  const cert = useFeature('certificate');
  if (!exportsShown([data, pro, cert])) return null;
  return (
    <Section id="exports" title="Exports & certificate" description="Take your progress with you, and show it.">
      {shown(data) && <ProgressExportRow state={data} />}
      {shown(pro) && <EmbedBrandingRow state={pro} />}
      {shown(cert) && <CertificateRow state={cert} />}
    </Section>
  );
}

/** The help line, followed by the way to `plan` when the feature is off. */
function help(text: ReactNode, state: FeatureState, plan: 'Pro' | 'Max') {
  return (
    <>
      {text}
      {!state.ok && !state.loading && (
        <span className="mt-1 block">
          <UpgradeHint>{`Part of ${plan}`}</UpgradeHint>
        </span>
      )}
    </>
  );
}

function ProgressExportRow({ state }: { state: FeatureState }) {
  const [busy, setBusy] = useState<'json' | 'csv'>();
  const [error, setError] = useState<string>();
  const download = async (format: 'json' | 'csv') => {
    setBusy(format);
    setError(undefined);
    try {
      const data = await getProgressExport();
      if (format === 'json') downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'proschi-progress.json');
      else downloadBlob(new Blob([writeZip(progressCsvFiles(data))], { type: 'application/zip' }), 'proschi-progress-csv.zip');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Row
      label="Progress data"
      help={help('Solved problems, mock interview verdicts, card states, mastery per skill, level and streaks: JSON, or CSV files for a spreadsheet.', state, 'Pro')}
      control={
        state.ok && (
          <>
            <button type="button" className={outlineButton} disabled={!!busy} onClick={() => void download('json')}>
              <Download size={14} aria-hidden="true" />
              {busy === 'json' ? 'Preparing…' : 'JSON'}
            </button>
            <button type="button" className={outlineButton} disabled={!!busy} onClick={() => void download('csv')}>
              <FileSpreadsheet size={14} aria-hidden="true" />
              {busy === 'csv' ? 'Preparing…' : 'CSV (.zip)'}
            </button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </Row>
  );
}

function EmbedBrandingRow({ state }: { state: FeatureState }) {
  const [branding, setBranding] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!state.ok) return;
    let live = true;
    getEmbedBranding().then(
      (b) => live && setBranding(b),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [state.ok]);
  // The switch moves at once, and back if the server refuses.
  const change = (hide: boolean) => {
    const was = branding;
    setError(undefined);
    setBranding(!hide);
    setEmbedBranding(!hide).then(setBranding, (e: unknown) => {
      setBranding(was);
      setError(errorText(e));
    });
  };
  return (
    <Row
      label="Embeds without Proschi branding"
      htmlFor={state.ok ? 'settings-embed-branding' : undefined}
      inline={state.ok}
      help={help(
        'Your short links’ embeds leave out the “Open in Proschi” button. With it, Pro also exports PNG images at 3× and the HLD as a PDF.',
        state,
        'Pro',
      )}
      control={
        state.ok && (
          <input
            id="settings-embed-branding"
            type="checkbox"
            role="switch"
            disabled={branding === undefined}
            checked={branding === false}
            onChange={(e) => change(e.target.checked)}
            className={switchInput}
          />
        )
      }
    >
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </Row>
  );
}

function CertificateRow({ state }: { state: FeatureState }) {
  const [mine, setMine] = useState<MyCertificate | null>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!state.ok) return;
    let live = true;
    getMyCertificate().then(
      (c) => live && setMine(c),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [state.ok]);
  const [pending, setPending] = useState<boolean>();
  // The switch moves at once, and back if the server refuses; the links wait for the answer (the id is the server's).
  const change = (on: boolean) => {
    setError(undefined);
    setPending(on);
    setCertificate(on).then(
      (c) => {
        setMine(c);
        setPending(undefined);
      },
      (e: unknown) => {
        setPending(undefined);
        setError(errorText(e));
      },
    );
  };
  const on = !!mine?.public;
  const url = mine ? certificateUrl(window.location.origin, mine.id) : '';
  return (
    <Row
      label="Mastery certificate"
      htmlFor={state.ok ? 'settings-certificate' : undefined}
      inline={state.ok}
      help={help(
        'A public page with your level, mastery per skill and problems solved, read from your progress each time it is opened, so anyone can check it. Turn it off to hide it at once.',
        state,
        'Max',
      )}
      control={
        state.ok && (
          <input
            id="settings-certificate"
            type="checkbox"
            role="switch"
            disabled={mine === undefined}
            checked={pending ?? on}
            onChange={(e) => change(e.target.checked)}
            className={switchInput}
          />
        )
      }
    >
      {state.ok && on && mine && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={`#/c/${mine.id}`} className={outlineButton}>
            <Award size={14} aria-hidden="true" />
            See your certificate
          </a>
          <a href={linkedInAddUrl(mine, url)} target="_blank" rel="noopener noreferrer" className={outlineButton}>
            <FaLinkedin size={14} aria-hidden="true" />
            Add to LinkedIn
            <ExternalLink size={12} aria-hidden="true" />
          </a>
          <ShareButton label="Share" text={`My system design mastery certificate on Proschi: ${url}`} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </Row>
  );
}
