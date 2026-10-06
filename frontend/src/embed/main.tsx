import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../design/site.css';
import ErrorBoundary from '../components/ErrorBoundary';
import Embed from './Embed';
import './embed.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="the embedded diagram">
      <Embed />
    </ErrorBoundary>
  </StrictMode>,
);
