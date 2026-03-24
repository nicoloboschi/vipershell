import useStore from '../store.js';
import SessionGroup from './SessionGroup.jsx';
import { ScrollArea } from './ui/scroll-area.jsx';
import { useGitRoots } from '../hooks/useGit.js';

const REPO_COLORS = [
  '#58a6ff', '#3fb950', '#d29922', '#bc8cff',
  '#ff7b72', '#79c0ff', '#ffa657', '#39d353',
];

function repoColor(gitRoot) {
  let h = 0;
  for (let i = 0; i < gitRoot.length; i++) h = (Math.imul(h, 31) + gitRoot.charCodeAt(i)) >>> 0;
  return REPO_COLORS[h % REPO_COLORS.length];
}

export default function SessionList({ onConnect, send, id, onAddToPane }) {
  const sessions = useStore(s => s.sessions);
  const gitRoots = useGitRoots();

  if (!sessions.length) {
    return (
      <ScrollArea id={id} className="session-list flex-1 py-2">
        <div className="empty-state">No sessions found</div>
      </ScrollArea>
    );
  }

  let groups;

  if (gitRoots) {
    const repoMap = new Map();
    const noGitMap = new Map();

    for (const s of sessions) {
      const gitRoot = gitRoots[s.id] ?? null;
      const path = s.path ?? '';
      if (gitRoot) {
        if (!repoMap.has(gitRoot)) repoMap.set(gitRoot, new Map());
        const pm = repoMap.get(gitRoot);
        if (!pm.has(path)) pm.set(path, []);
        pm.get(path).push(s);
      } else {
        if (!noGitMap.has(path)) noGitMap.set(path, []);
        noGitMap.get(path).push(s);
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
    const byPath = new Map();
    for (const s of sessions) {
      const key = s.path ?? '';
      if (!byPath.has(key)) byPath.set(key, []);
      byPath.get(key).push(s);
    }
    groups = Array.from(byPath.entries()).map(([path, ss]) => ({
      gitRoot: null,
      pathGroups: [{ path, sessions: ss }],
    }));
  }

  return (
    <ScrollArea id={id} className="session-list flex-1 py-2">
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
          ? <div key={gitRoot} className="session-repo-group" style={{ '--repo-color': repoColor(gitRoot) }}>{inner}</div>
          : <div key={(gitRoot ?? '') + ':' + pathGroups[0]?.path}>{inner}</div>;
      })}
    </ScrollArea>
  );
}
