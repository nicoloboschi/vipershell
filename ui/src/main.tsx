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
