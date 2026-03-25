import { useEffect, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import useStore, { type Session } from '../store';
import { relativeTime } from '../utils';
import ClaudeIcon from './ClaudeIcon';

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onConnect: (id: string) => void;
}

export default function SessionItem({ session, isActive, onConnect }: SessionItemProps) {
  const unseen      = useStore(s => s.sessionHasUnseen[session.id] ?? false);
  const lastEvent   = useStore(s => s.sessionLastEvent[session.id] ?? null);
  const lastCommand = useStore(s => s.sessionLastCommand[session.id] ?? null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const time = relativeTime(lastEvent);

  return (
    <div
      className={['session-item', isActive ? 'active' : '', unseen ? 'unseen' : ''].filter(Boolean).join(' ')}
      data-session-id={session.id}
      onClick={() => onConnect(session.id)}
    >
      <span className={`session-icon${unseen ? ' session-icon-unseen' : ''}`}>
        {session.isClaudeCode
          ? <ClaudeIcon size={12} />
          : <SquareTerminal size={12} />
        }
      </span>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={`session-name-inline${unseen && !isActive ? ' session-name-unseen' : ''}`} style={{ flex: 1 }}>{session.name || '\u2014'}</span>
          <span className="session-time">{time ?? ''}</span>
        </div>
        {lastCommand && (
          <div style={{ fontSize: 10, color: 'var(--muted-foreground)', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7, marginTop: 1 }}>
            {lastCommand}
          </div>
        )}
      </div>
    </div>
  );
}
