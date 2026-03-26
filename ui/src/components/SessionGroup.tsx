import { Plus, GitBranch, GitPullRequest } from 'lucide-react';
import { tildefy } from '../utils';
import SessionItem from './SessionItem';
import useStore, { type Session } from '../store';
import { Button } from './ui/button';
import { useGit, useGithubPR } from '../hooks/useGit';

const PR_STATE_COLORS: Record<string, string> = {
  OPEN: '#3fb950', MERGED: '#a371f7', CLOSED: '#f85149',
};

function BranchBadge({ sessionId }: { sessionId: string }) {
  const git = useGit(sessionId);
  const github = useGithubPR(sessionId);
  if (!git?.branch) return null;
  const color = git.dirty ? '#d29922' : '#3fb950';
  const pr = github?.prNum ? github : null;
  const prColor = pr ? (PR_STATE_COLORS[pr.prState ?? ''] ?? '#8b949e') : '';
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 9, fontFamily: '"Cascadia Code","JetBrains Mono",ui-monospace,monospace' }}>
      <GitBranch size={8} strokeWidth={2} style={{ color }} />
      <span style={{ color }}>{git.branch}</span>
      {pr && (
        <>
          <span style={{ width: 1, height: 10, background: 'var(--border)', flexShrink: 0 }} />
          <a
            href={pr.prUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 2, color: prColor, textDecoration: 'none' }}
            title={`PR #${pr.prNum} ${pr.prState?.toLowerCase() ?? ''}`}
          >
            <GitPullRequest size={8} strokeWidth={2} />
            <span>#{pr.prNum}</span>
          </a>
        </>
      )}
    </span>
  );
}

interface SessionGroupProps {
  path: string;
  sessions: Session[];
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
}

export default function SessionGroup({ path, sessions, onConnect, send }: SessionGroupProps) {
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
        />
      ))}
    </div>
  );
}
