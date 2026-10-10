import { useCallback, useEffect, useState } from 'react';
import { tabPanelProps } from '../design/classes';
import Tabs from '../design/Tabs';
import ThemeToggle from '../design/ThemeToggle';
import Wordmark from '../design/Wordmark';
import { apiEnabled } from '../services/api';
import { getStatus, signOut, type Status } from './api';
import { parseRoute, routeHash, TABS, type Route } from './route';
import { AuditTab, EventsTab } from './EventsTab';
import Gate from './Gate';
import HealthTab from './HealthTab';
import OverviewTab from './OverviewTab';
import PasskeysTab from './PasskeysTab';
import SharesTab from './SharesTab';
import { useLoad } from './hooks';
import { ErrorNote, Loading } from './ui';
import UsersTab from './UsersTab';

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((next: Route) => {
    window.location.hash = routeHash(next);
  }, []);
  return [route, go];
}

/** The admin panel (/admin/): the passkey gate, then the tabs. */
export default function AdminApp() {
  const [nonce, setNonce] = useState(0);
  const status = useLoad<Status | undefined>(() => (apiEnabled ? getStatus() : Promise.resolve(undefined)), [nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  let body;
  if (!apiEnabled) {
    body = (
      <main className="adm-gate">
        <div className="ps-card adm-gate__card">
          <h1>Admin panel</h1>
          <p>This copy of the site has no API. The admin panel works on the deployed site (proschi.app) or with the Worker running locally (backend/, npm run dev).</p>
        </div>
      </main>
    );
  } else if (!status.data) {
    body = <main className="adm-gate">{status.error ? <ErrorNote>{status.error}</ErrorNote> : <Loading what="the admin panel" />}</main>;
  } else if (!status.data.signedIn) {
    body = <Gate status={status.data} onSignedIn={refresh} />;
  } else {
    body = <Panel onSignedOut={refresh} />;
  }

  return (
    <div className="adm">
      <header className="adm-header">
        <Wordmark href="../" compact />
        <span className="adm-header__title">Admin</span>
        <span className="adm-header__space" />
        {status.data?.signedIn && (
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void signOut().finally(refresh)}>
            Sign out
          </button>
        )}
        <ThemeToggle />
      </header>
      {body}
    </div>
  );
}

function Panel({ onSignedOut }: { onSignedOut: () => void }) {
  const [route, go] = useRoute();
  const openUser = (id?: string) => go({ tab: 'users', param: id });
  const openEvents = (kind: string) => go({ tab: 'events', param: kind || undefined });
  let content;
  switch (route.tab) {
    case 'health':
      content = <HealthTab onSignedOut={onSignedOut} onOpenEvents={openEvents} />;
      break;
    case 'users':
      content = <UsersTab key={route.param ?? ''} userId={route.param} onOpen={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'shares':
      content = <SharesTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'events':
      content = <EventsTab kind={route.param ?? ''} onKind={openEvents} onSignedOut={onSignedOut} />;
      break;
    case 'audit':
      content = <AuditTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'passkeys':
      content = <PasskeysTab onSignedOut={onSignedOut} />;
      break;
    default:
      content = <OverviewTab onSignedOut={onSignedOut} onOpenEvents={openEvents} />;
  }
  return (
    <main className="adm-main">
      <Tabs label="Admin sections" idPrefix="adm" items={[...TABS]} value={route.tab} onChange={(tab) => go({ tab })} className="adm-tabs" />
      <div {...tabPanelProps('adm', route.tab)} className="adm-panel">
        {content}
      </div>
    </main>
  );
}
