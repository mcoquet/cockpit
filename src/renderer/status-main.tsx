import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Status from './Status';
import './status.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Status />
  </StrictMode>
);
