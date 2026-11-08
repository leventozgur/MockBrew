import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initToken } from './api';
import { StudioProvider } from './store';
import './styles.css';

const hasToken = initToken() !== null;
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {hasToken ? (
        <StudioProvider>
          <App />
        </StudioProvider>
      ) : (
        <div className="centered">
          <h1>MockBrew</h1>
          <p>
            Open this page with the address printed by <code>mockbrew ui</code>; it carries the session token.
          </p>
        </div>
      )}
    </StrictMode>,
  );
}
