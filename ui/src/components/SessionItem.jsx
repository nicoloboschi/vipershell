import { useEffect, useState } from 'react';
import useStore from '../store.js';
import { relativeTime } from '../utils.js';

/**
 * @param {{
 *   session: object,
 *   isActive: boolean,
 *   onConnect: (id: string) => void,
 *   send: (msg: object) => void,
 * }} props
 */
export default function SessionItem({ session, isActive, onConnect }) {
  const preview     = useStore(s => s.sessionPreviews[session.id] ?? '');
  const busy        = useStore(s => s.sessionBusy[session.id] ?? false);
  const lastEvent   = useStore(s => s.sessionLastEvent[session.id] ?? null);
  // Tick every 5s so relative time stays fresh
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);


  const itemClass = [
    'session-item',
    isActive ? 'active' : '',
    busy ? 'busy' : '',
  ].filter(Boolean).join(' ');

  const time = relativeTime(lastEvent);

  return (
    <div
      className={itemClass}
      data-session-id={session.id}
      onClick={() => onConnect(session.id)}
    >
      <div className="session-info">
        <div className="session-name">{session.name}</div>
        <div className="session-preview">{preview}</div>
        {time && <div className="session-time">{time}</div>}
      </div>

    </div>
  );
}
