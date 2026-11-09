import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../reloadOnStaleChunk';
import ErrorBoundary from '../components/ErrorBoundary';
import ShareView from './ShareView';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="the shared diagram">
      <ShareView />
    </ErrorBoundary>
  </StrictMode>,
);
