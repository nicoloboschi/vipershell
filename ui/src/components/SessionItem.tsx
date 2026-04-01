import { useEffect, useRef, useState } from 'react';
import { SquareTerminal, GitBranch, GitPullRequest } from 'lucide-react';
import useStore, { type Session } from '../store';
import { relativeTime } from '../utils';
import ClaudeIcon from './ClaudeIcon';
import OpenAIIcon from './OpenAIIcon';
import HermesIcon from './HermesIcon';

/** Truncate branch names smartly, preserving prefix and last hyphenated segment(s).
 *  "fix/retain-deadlock-prevention" → "fix/…deadlock-prevention"
 *  "feature/long-name-here"        → "feature/…name-here"
 */
function truncateBranch(branch: string, maxLen = 22): string {
  if (branch.length <= maxLen) return branch;
  const slashIdx = branch.indexOf('/');
  if (slashIdx > 0 && slashIdx < branch.length - 1) {
    const prefix = branch.slice(0, slashIdx + 1); // e.g. "fix/"
    const suffix = branch.slice(slashIdx + 1);     // e.g. "retain-deadlock-prevention"
    const budget = maxLen - prefix.length - 1;      // chars available after "fix/…"
    if (budget > 6) {
      // Walk hyphen-separated segments from the end until we fill the budget
      const parts = suffix.split('-');
      let tail = '';
      for (let i = parts.length - 1; i >= 0; i--) {
        const candidate = i < parts.length - 1 ? parts[i] + '-' + tail : parts[i]!;
        if (candidate.length <= budget) {
          tail = candidate;
        } else {
          break;
        }
      }
      if (tail && tail !== suffix) {
        return prefix + '\u2026' + tail;
      }
    }
  }
  // Fallback: keep the end
  return '\u2026' + branch.slice(-(maxLen - 1));
}

const PR_STATE_COLORS: Record<string, string> = {
  OPEN: 'var(--primary)', MERGED: '#C084FC', CLOSED: 'var(--destructive)',
};

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onConnect: (id: string) => void;
  pathDotColor?: string;
}

export default function SessionItem({ session, isActive, onConnect, pathDotColor }: SessionItemProps) {
  const unseen      = useStore(s => s.sessionHasUnseen[session.id] ?? false);
  const lastEvent   = useStore(s => s.sessionLastEvent[session.id] ?? null);
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
  const branchColor = session.gitDirty ? '#a3a3a3' : '#737373';
  const prColor = session.prNum ? (PR_STATE_COLORS[session.prState ?? ''] ?? 'var(--muted-foreground)') : '';
  const memTitle = (session.memMb ?? 0) > 0
    ? `Mem: ${(session.memMb ?? 0) >= 1024 ? `${((session.memMb ?? 0) / 1024).toFixed(1)} GB` : `${session.memMb} MB`}`
    : undefined;

  return (
    <div
      ref={elRef}
      className={['session-item', isActive ? 'active' : '', unseen ? 'unseen' : ''].filter(Boolean).join(' ')}
      data-session-id={session.id}
      onClick={() => onConnect(session.id)}
      title={memTitle}
    >
      <span className={`session-icon${unseen ? ' session-icon-unseen' : ''}`}>
        {session.isClaudeCode
          ? <ClaudeIcon size={12} />
          : session.isCodex
            ? <OpenAIIcon size={12} />
            : session.isHermes
              ? <HermesIcon size={12} />
              : <SquareTerminal size={12} />
        }
      </span>
      {pathDotColor && (
        <span
          style={{
            width: 5, height: 5, borderRadius: '50%',
            background: pathDotColor, flexShrink: 0, opacity: 0.7,
          }}
          title={session.path}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {/* Row 1: name + branch + PR chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={`session-name-inline${unseen && !isActive ? ' session-name-unseen' : ''}`} style={{ flex: 1 }}>{session.name || '\u2014'}</span>
          {session.gitBranch && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, fontSize: 9, fontFamily: '"JetBrains Mono",monospace' }}
              title={session.gitBranch}
            >
              <GitBranch size={8} strokeWidth={2} style={{ color: branchColor }} />
              <span style={{ color: branchColor, whiteSpace: 'nowrap' }}>{truncateBranch(session.gitBranch)}</span>
            </span>
          )}
          {session.prNum && (
            <a
              href={session.prUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: 2,
                fontSize: 9, fontFamily: '"JetBrains Mono",monospace',
                color: prColor, textDecoration: 'none', flexShrink: 0,
                background: 'rgba(255,255,255,0.04)', padding: '0 4px',
                borderRadius: 3, lineHeight: '16px',
              }}
              title={`PR #${session.prNum} ${session.prState?.toLowerCase() ?? ''}`}
            >
              <GitPullRequest size={8} strokeWidth={2} />
              <span>#{session.prNum}</span>
            </a>
          )}
        </div>
        {/* Row 2: timestamp */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="session-time">{time ?? ''}</span>
        </div>
      </div>
    </div>
  );
}
