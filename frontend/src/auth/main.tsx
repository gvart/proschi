import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../reloadOnStaleChunk'
import ErrorBoundary from '../components/ErrorBoundary'
import SignInApp from './SignInApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="signin">
      <SignInApp />
    </ErrorBoundary>
  </StrictMode>,
)
