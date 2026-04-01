import { GripVertical, Plus } from 'lucide-react';
import SessionItem from './SessionItem';
import useStore, { type Session } from '../store';
import { Button } from './ui/button';

const PATH_COLORS = [
  '#4ADE80', '#60A5FA', '#C084FC', '#F472B6',
  '#FACC15', '#FB923C', '#2DD4BF', '#A78BFA',
];

function pathColor(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (Math.imul(h, 31) + path.charCodeAt(i)) >>> 0;
  return PATH_COLORS[h % PATH_COLORS.length]!;
}

interface SessionGroupProps {
  name: string;
  path: string | null;
  sessions: Session[];
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
  workspaceKey: string;
  isDragOver: boolean;
  onDragStart: (key: string) => void;
  onDragOver: (e: React.DragEvent, key: string) => void;
  onDragLeave: () => void;
  onDrop: (key: string) => void;
  onDragEnd: () => void;
}

export default function SessionGroup({ name, path, sessions, onConnect, send, workspaceKey, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }: SessionGroupProps) {
  const currentSessionId = useStore(s => s.currentSessionId);

  const uniquePaths = new Set(sessions.map(s => s.path ?? ''));
  const showPathDots = uniquePaths.size > 1;

  const handleAddSession = () => {
    send({ type: 'create_session', path: path || null });
  };

  return (
    <div className="session-workspace">
      <div
        className="session-group-header"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', workspaceKey);
          onDragStart(workspaceKey);
        }}
        onDragOver={(e) => onDragOver(e, workspaceKey)}
        onDragLeave={onDragLeave}
        onDrop={(e) => { e.preventDefault(); onDrop(workspaceKey); }}
        onDragEnd={onDragEnd}
        style={{
          cursor: 'grab',
          borderTop: isDragOver ? '2px solid var(--primary)' : '2px solid transparent',
          transition: 'border-color 0.15s',
        }}
      >
        <GripVertical size={10} style={{ color: 'var(--muted-foreground)', opacity: 0.3, flexShrink: 0 }} />
        <span className="session-group-label" title={path ?? undefined}>
          {name}
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
          pathDotColor={showPathDots ? pathColor(session.path ?? '') : undefined}
        />
      ))}
    </div>
  );
}
