import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LearningStudio } from './components/workspace/LearningStudio.tsx';
import './app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LearningStudio />
  </StrictMode>,
);
