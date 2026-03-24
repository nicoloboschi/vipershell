import { Plus, GitBranch } from 'lucide-react';
import { tildefy } from '../utils';
import SessionItem from './SessionItem';
import useStore, { type Session } from '../store';
import { Button } from './ui/button';
import { useGit } from '../hooks/useGit';

function BranchBadge({ sessionId }: { sessionId: string }) {
  const git = useGit(sessionId);
  if (!git?.branch) return null;
  const color = git.dirty ? '#d29922' : '#3fb950';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, color, fontSize: 9, fontFamily: '"Cascadia Code","JetBrains Mono",ui-monospace,monospace' }}>
      <GitBranch size={8} strokeWidth={2} />
      {git.branch}
    </span>
  );
}

interface SessionGroupProps {
  path: string;
  sessions: Session[];
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
  onAddToPane?: ((id: string) => void) | null;
}

export default function SessionGroup({ path, sessions, onConnect, send, onAddToPane }: SessionGroupProps) {
  const currentSessionId = useStore(s => s.currentSessionId);

  const fullPath = path ? tildefy(path, sessions[0]?.username) : 'Other';
  const displayPath = (() => {
    if (!path || !fullPath || fullPath.length <= 24) return fullPath;
    const parts = fullPath.split('/');
    if (parts.length <= 3) return fullPath;
    return parts[0] + '/\u2026/' + parts[parts.length - 1];
  })();

  const handleAddSession = () => {
    send({ type: 'create_session', path: path || null });
  };

  return (
    <div>
      <div className="session-group-header">
        <span className="session-group-label" title={fullPath ?? undefined}>
          {displayPath}
        </span>
        <BranchBadge sessionId={sessions[0]?.id ?? ''} />
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
          onAddToPane={onAddToPane}
        />
      ))}
    </div>
  );
}
