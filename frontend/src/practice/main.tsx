import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import PracticeApp from './PracticeApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PracticeApp />
  </StrictMode>,
)
