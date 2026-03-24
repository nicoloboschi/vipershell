import { useEffect, useState } from 'react';
import { PanelRight } from 'lucide-react';
import useStore from '../store.js';
import { relativeTime } from '../utils.js';

const EMPTY_PANES = [];

export default function SessionItem({ session, isActive, onConnect, onAddToPane }) {
  const busy        = useStore(s => s.sessionBusy[session.id] ?? false);
  const lastEvent   = useStore(s => s.sessionLastEvent[session.id] ?? null);
  const paneIndices = useStore(s => s.openPaneMap?.[session.id] ?? EMPTY_PANES);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const time = relativeTime(lastEvent);

  return (
    <div
      className={['session-item', isActive ? 'active' : '', busy ? 'busy' : ''].filter(Boolean).join(' ')}
      data-session-id={session.id}
      onClick={() => onConnect(session.id)}
    >
      <span className={`session-state-dot${busy ? ' busy' : ''}`} />
      <span className="session-name-inline">{session.name || '—'}</span>
      <span className="session-time">{time ?? ''}</span>
      {paneIndices.length > 0 && (
        <span className="session-pane-badge" title={`Open in pane ${paneIndices.map(i => i + 1).join(', ')}`}>
          {paneIndices.map(i => i + 1).join('·')}
        </span>
      )}
      {onAddToPane && (
        <button
          title="Open in new pane"
          className="session-add-pane-btn"
          onClick={e => { e.stopPropagation(); onAddToPane(session.id); }}
        >
          <PanelRight size={11} />
        </button>
      )}
    </div>
  );
}
