import { useCallback, useEffect, useState } from 'react';
import ThemeToggle from '../design/ThemeToggle';
import Wordmark from '../design/Wordmark';
import { apiEnabled } from '../services/api';
import { getStatus, signOut, type Status } from './api';
import { parseRoute, routeHash, type Route } from './route';
import AiTab from './AiTab';
import BillingTab from './BillingTab';
import CampaignsTab from './CampaignsTab';
import CloudflareTab from './CloudflareTab';
import { AuditTab, EventsTab } from './EventsTab';
import Nav from './Nav';
import Gate from './Gate';
import HealthTab from './HealthTab';
import InboxTab from './InboxTab';
import { listFeedback } from './feedbackApi';
import OverviewTab from './OverviewTab';
import PasskeysTab from './PasskeysTab';
import SharesTab from './SharesTab';
import { useLoad } from './hooks';
import { ErrorNote, Loading } from './ui';
import UsersTab from './UsersTab';
import WebhooksTab from './WebhooksTab';

/** The route in the hash; an old or unknown hash is replaced by the page's own (#/shares becomes #/links). */
function canonical(hash: string): Route {
  const route = parseRoute(hash);
  if (hash && hash !== routeHash(route)) window.history.replaceState(null, '', routeHash(route));
  return route;
}

function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => canonical(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(canonical(window.location.hash));
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
  const openUser = (id?: string) => go({ page: 'users', param: id });
  const openEvents = (kind: string) => go({ page: 'events', param: kind || undefined });
  // The Inbox's unread count for the sidebar, again after each page change and each change in the Inbox.
  const [inboxNonce, setInboxNonce] = useState(0);
  const refreshInbox = useCallback(() => setInboxNonce((n) => n + 1), []);
  const inbox = useLoad(() => listFeedback({ status: 'open', kind: '', q: '', offset: 0 }), [route.page, inboxNonce]);
  let content;
  switch (route.page) {
    case 'health':
      content = <HealthTab onSignedOut={onSignedOut} onOpenEvents={openEvents} />;
      break;
    case 'cloudflare':
      content = <CloudflareTab onSignedOut={onSignedOut} />;
      break;
    case 'users':
      content = <UsersTab key={route.param ?? ''} userId={route.param} onOpen={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'campaigns':
      content = <CampaignsTab param={route.param} onOpen={(id) => go({ page: 'campaigns', param: id })} onSignedOut={onSignedOut} />;
      break;
    case 'billing':
      content = <BillingTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'ai':
      content = <AiTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'inbox':
      content = <InboxTab key={route.param ?? ''} messageId={route.param} onOpen={(id) => go({ page: 'inbox', param: id })} onOpenUser={openUser} onChanged={refreshInbox} onSignedOut={onSignedOut} />;
      break;
    case 'links':
      content = <SharesTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'events':
      content = <EventsTab kind={route.param ?? ''} onKind={openEvents} onSignedOut={onSignedOut} />;
      break;
    case 'webhooks':
      content = <WebhooksTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'audit':
      content = <AuditTab onOpenUser={openUser} onSignedOut={onSignedOut} />;
      break;
    case 'passkeys':
      content = <PasskeysTab onSignedOut={onSignedOut} />;
      break;
    default:
      content = <OverviewTab range={route.param} onRange={(days) => go({ page: 'overview', param: days })} onSignedOut={onSignedOut} onOpenEvents={openEvents} />;
  }
  return (
    <div className="adm-shell">
      <Nav current={route.page} counts={{ inbox: inbox.data?.counts.unread }} />
      <main className="adm-main" key={route.page}>
        {content}
      </main>
    </div>
  );
}
