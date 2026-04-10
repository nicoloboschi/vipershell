import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import 'xterm/css/xterm.css';
import { initServerUrl, needsConnect, setServerUrl, installFetchInterceptor } from './serverUrl';
import App from './App';
import ConnectScreen from './components/ConnectScreen';

// Initialize server URL from localStorage before first render
initServerUrl();
installFetchInterceptor();

// Swallow xterm.js's benign async renderer race:
// "Cannot read properties of undefined (reading 'dimensions')"
// This fires when xterm's Viewport schedules a refresh before its
// renderer is fully initialized. The error is harmless — the terminal
// recovers on the next render cycle.
window.addEventListener('error', (e) => {
  if (e.message?.includes("reading 'dimensions'") || e.error?.message?.includes("reading 'dimensions'")) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return false;
  }
}, true);

function Root() {
  const [connected, setConnected] = useState(!needsConnect());

  if (!connected) {
    return (
      <ConnectScreen
        onConnected={(url) => {
          setServerUrl(url);
          installFetchInterceptor();
          setConnected(true);
        }}
      />
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
