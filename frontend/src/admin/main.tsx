import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './admin.css'
import '../reloadOnStaleChunk'
import ErrorBoundary from '../components/ErrorBoundary'
import AdminApp from './AdminApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="the admin panel">
      <AdminApp />
    </ErrorBoundary>
  </StrictMode>,
)
