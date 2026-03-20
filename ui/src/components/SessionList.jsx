import useStore from '../store.js';
import SessionGroup from './SessionGroup.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';

/**
 * @param {{
 *   onConnect: (id: string) => void,
 *   send: (msg: object) => void,
 *   id?: string,
 * }} props
 */
export default function SessionList({ onConnect, send, id }) {
  const sessions = useStore(s => s.sessions);

  if (!sessions.length) {
    return (
      <ScrollArea id={id} className="session-list flex-1 py-2">
        <div className="empty-state">No sessions found</div>
      </ScrollArea>
    );
  }

  // Group sessions by path
  const byPath = {};
  for (const s of sessions) {
    const key = s.path ?? '';
    if (!byPath[key]) byPath[key] = [];
    byPath[key].push(s);
  }

  return (
    <ScrollArea id={id} className="session-list flex-1 py-2">
      {Object.entries(byPath).map(([path, group]) => (
        <SessionGroup
          key={path}
          path={path}
          sessions={group}
          onConnect={onConnect}
          send={send}
        />
      ))}
    </ScrollArea>
  );
}
