import { Plus } from 'lucide-react';
import { tildefy } from '../utils.js';
import SessionItem from './SessionItem.jsx';
import useStore from '../store.js';
import { Button } from './ui/button.jsx';

/**
 * @param {{
 *   path: string,
 *   sessions: object[],
 *   onConnect: (id: string) => void,
 *   send: (msg: object) => void,
 * }} props
 */
export default function SessionGroup({ path, sessions, onConnect, send }) {
  const currentSessionId = useStore(s => s.currentSessionId);

  const displayPath = path
    ? tildefy(path, sessions[0]?.username)
    : 'Other';

  const handleAddSession = () => {
    send({ type: 'create_session', path: path || null });
  };

  return (
    <div>
      <div className="session-group-header">
        <span className="session-group-label" title={displayPath}>
          {displayPath}
        </span>
        <Button
          variant="ghost"
          size="icon"
          title="New session here"
          onClick={handleAddSession}
          className="h-5 w-5 text-primary opacity-60 hover:opacity-100 hover:bg-transparent hover:text-primary"
        >
          <Plus size={14} />
        </Button>
      </div>
      {sessions.map(session => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === currentSessionId}
          onConnect={onConnect}
          send={send}
        />
      ))}
    </div>
  );
}
