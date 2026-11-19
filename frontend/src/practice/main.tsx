import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../reloadOnStaleChunk'
import ErrorBoundary from '../components/ErrorBoundary'
import PracticeApp from './PracticeApp'
import { profileAddressOf } from './profile/profile'
import { certificateAddressOf } from './certificate/route'
import { landsOnRoadmap } from './hub/goal'

// Served at a profile's own address (/u/<id>, for its link previews), the page shows the profile at its hash route.
// The same for a certificate's (/c/<id>).
const profileAddress = profileAddressOf(window.location.pathname) ?? certificateAddressOf(window.location.pathname)
if (profileAddress) window.history.replaceState(null, '', profileAddress)
// Interview prep opens on the roadmap (the guided path); `#/` is still the list.
else if (landsOnRoadmap(window.location.hash)) window.history.replaceState(window.history.state, '', '#/roadmap')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where="practice">
      <PracticeApp />
    </ErrorBoundary>
  </StrictMode>,
)
