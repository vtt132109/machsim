import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import App from './ui/app/App';
import { installIntegration } from './ui/integration';
import { LanguageRoot } from './i18n/react';

// The desktop shell opens index.html?batch for command-line runs (MachSim.exe --batch …): no UI,
// the batch runner reads the arguments from the shell, simulates and reports back.
const batch = typeof location !== 'undefined' && new URLSearchParams(location.search).has('batch');

if (batch) {
  void import('./desktop/batchRenderer').then((m) => m.runBatchFromBridge());
} else {
  // simulation engine, instruments, results, reports, examples and the breadboard view
  installIntegration();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <LanguageRoot>
        <App />
      </LanguageRoot>
    </StrictMode>,
  );
}
