import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../reloadOnStaleChunk'
import ErrorBoundary from '../components/ErrorBoundary'
import PricingApp from './PricingApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="pricing">
      <PricingApp />
    </ErrorBoundary>
  </StrictMode>,
)
