import { useEffect, useRef, useState } from 'react';
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
  const elRef = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isActive && elRef.current) {
      elRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  const time = relativeTime(lastEvent);

  return (
    <div
      ref={elRef}
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
          {(session.cpuPercent ?? 0) > 5 && (
            <span
              style={{
                fontSize: 9,
                fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                color: (session.cpuPercent ?? 0) > 80 ? '#ff7b72' : (session.cpuPercent ?? 0) > 30 ? '#d29922' : '#8b949e',
                flexShrink: 0,
              }}
              title={`CPU: ${session.cpuPercent?.toFixed(0)}% | Mem: ${session.memMb ?? 0} MB`}
            >
              {session.cpuPercent!.toFixed(0)}%
            </span>
          )}
          {(session.memMb ?? 0) > 100 && (
            <span
              style={{
                fontSize: 9,
                fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                color: (session.memMb ?? 0) > 1024 ? '#ff7b72' : (session.memMb ?? 0) > 500 ? '#d29922' : '#8b949e',
                flexShrink: 0,
              }}
              title={`Mem: ${session.memMb} MB`}
            >
              {(session.memMb ?? 0) >= 1024 ? `${((session.memMb ?? 0) / 1024).toFixed(1)}G` : `${session.memMb}M`}
            </span>
          )}
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
