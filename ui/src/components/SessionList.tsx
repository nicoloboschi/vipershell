import { StickyNote, SquareTerminal } from 'lucide-react';
import useStore, { type Session } from '../store';
import SessionGroup from './SessionGroup';
import { ScrollArea } from './ui/scroll-area';
import { useGitRoots } from '../hooks/useGit';
import { NOTES_SESSION_ID } from './PaneTerminal';

const REPO_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#bc8cff',
  '#ff7b72', '#79c0ff', '#ffa657', '#39d353',
];

function repoColor(gitRoot: string): string {
  let h = 0;
  for (let i = 0; i < gitRoot.length; i++) h = (Math.imul(h, 31) + gitRoot.charCodeAt(i)) >>> 0;
  return REPO_COLORS[h % REPO_COLORS.length]!;
}

interface PathGroup {
  path: string;
  sessions: Session[];
}

interface RepoGroup {
  gitRoot: string | null;
  pathGroups: PathGroup[];
}

interface SessionListProps {
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
  id?: string;
  onAddToPane?: ((id: string) => void) | null;
}

export default function SessionList({ onConnect, send, id, onAddToPane }: SessionListProps) {
  const sessions = useStore(s => s.sessions);
  const currentSessionId = useStore(s => s.currentSessionId);
  const gitRoots = useGitRoots();

  if (!sessions.length) {
    return (
      <ScrollArea id={id} className="session-list flex-1 py-2">
        <div className="empty-state">No sessions found</div>
      </ScrollArea>
    );
  }

  let groups: RepoGroup[];

  if (gitRoots) {
    const repoMap = new Map<string, Map<string, Session[]>>();
    const noGitMap = new Map<string, Session[]>();

    for (const s of sessions) {
      const gitRoot = gitRoots[s.id] ?? null;
      const path = s.path ?? '';
      if (gitRoot) {
        if (!repoMap.has(gitRoot)) repoMap.set(gitRoot, new Map());
        const pm = repoMap.get(gitRoot)!;
        if (!pm.has(path)) pm.set(path, []);
        pm.get(path)!.push(s);
      } else {
        if (!noGitMap.has(path)) noGitMap.set(path, []);
        noGitMap.get(path)!.push(s);
      }
    }

    groups = [
      ...Array.from(repoMap.entries()).map(([gitRoot, pathMap]) => ({
        gitRoot,
        pathGroups: Array.from(pathMap.entries()).map(([path, ss]) => ({ path, sessions: ss })),
      })),
      ...Array.from(noGitMap.entries()).map(([path, ss]) => ({
        gitRoot: null,
        pathGroups: [{ path, sessions: ss }],
      })),
    ];
  } else {
    const byPath = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = s.path ?? '';
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key)!.push(s);
    }
    groups = Array.from(byPath.entries()).map(([path, ss]) => ({
      gitRoot: null,
      pathGroups: [{ path, sessions: ss }],
    }));
  }

  const isNotesActive = currentSessionId === NOTES_SESSION_ID;

  const sectionLabelStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 16px 4px', fontSize: 10, fontWeight: 600,
    color: 'var(--muted-foreground)', textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <ScrollArea id={id} className="session-list flex-1 py-2">
      <button
        onClick={() => onConnect(NOTES_SESSION_ID)}
        data-session-id={NOTES_SESSION_ID}
        className="session-item"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          width: '100%', padding: '6px 16px',
          background: isNotesActive ? 'var(--accent)' : 'none',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          color: isNotesActive ? 'var(--foreground)' : 'var(--muted-foreground)',
          fontSize: 12,
        }}
      >
        <StickyNote size={13} />
        <span>Notes</span>
      </button>

      <div style={sectionLabelStyle}>
        <SquareTerminal size={11} />
        <span>Sessions</span>
      </div>

      {groups.map(({ gitRoot, pathGroups }) => {
        const linked = pathGroups.length > 1;
        const inner = pathGroups.map(({ path, sessions: ss }) => (
          <SessionGroup
            key={(gitRoot ?? '') + ':' + path}
            path={path}
            sessions={ss}
            onConnect={onConnect}
            send={send}
            onAddToPane={onAddToPane}
          />
        ));
        return linked
          ? <div key={gitRoot!} className="session-repo-group" style={{ '--repo-color': repoColor(gitRoot!) } as React.CSSProperties}>{inner}</div>
          : <div key={(gitRoot ?? '') + ':' + pathGroups[0]?.path}>{inner}</div>;
      })}
    </ScrollArea>
  );
}
