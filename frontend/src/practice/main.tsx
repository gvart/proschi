import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../reloadOnStaleChunk'
import ErrorBoundary from '../components/ErrorBoundary'
import PracticeApp from './PracticeApp'
import { profileAddressOf } from './profile/profile'

// Served at a profile's own address (/u/<id>, for its link previews), the page shows the profile at its hash route.
const profileAddress = profileAddressOf(window.location.pathname)
if (profileAddress) window.history.replaceState(null, '', profileAddress)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="practice">
      <PracticeApp />
    </ErrorBoundary>
  </StrictMode>,
)
