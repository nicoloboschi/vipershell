import { useEffect, useRef, useState } from 'react';
import { Trash2, SquareTerminal, GitBranch, FolderOpen, Search } from 'lucide-react';
import useStore from '../store.js';
import StatChips from './StatChips.jsx';

export default function SessionStatsBar({ sessionId, send, activeTab, onTabChange, onConnect }) {
  const sessionMap  = useStore(s => s.sessionMap);
  const showConfirm = useStore(s => s.showConfirm);
  const [editing, setEditing]     = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef(null);

  if (!sessionId) return null;
  const session = sessionMap[sessionId];

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Reset edit state when session changes
  useEffect(() => { setEditing(false); }, [sessionId]);

  function startEdit() {
    setDraftName(session?.name ?? '');
    setEditing(true);
  }

  async function commitRename() {
    setEditing(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === session?.name) return;
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
  }

  const handleClose = async () => {
    const name = session?.name ?? 'session';
    const confirmed = await showConfirm(`Close session "${name}"?`);
    if (confirmed) {
      const prevId = useStore.getState().navigateSession('up');
      if (prevId && prevId !== sessionId && onConnect) onConnect(prevId);
      send({ type: 'close_session', session_id: sessionId });
    }
  };

  const tabs = onTabChange ? [
    { id: 'terminal', icon: <SquareTerminal size={11} />, label: 'Terminal' },
    { id: 'diff',     icon: <GitBranch size={11} />,      label: 'Git Diff' },
    { id: 'files',    icon: <FolderOpen size={11} />,     label: 'Files'    },
    { id: 'search',   icon: <Search size={11} />,         label: 'Search'   },
  ] : [];

  const tabBar = onTabChange && (
    <div
      className="flex items-center shrink-0"
      style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}
    >
      {tabs.map(({ id, icon, label }) => (
        <button
          key={id}
          title={label}
          onClick={() => onTabChange(id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '2px 8px',
            background: activeTab === id ? 'var(--accent)' : 'none',
            color: activeTab === id ? 'var(--foreground)' : 'var(--muted-foreground)',
            border: 'none', borderRight: id !== 'search' ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
          }}
        >
          {icon}{label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop bar: full layout */}
      <div
        className="hidden md:flex items-center gap-1 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              fontSize: 11, color: 'var(--foreground)', background: 'var(--input)',
              border: '1px solid var(--ring)', borderRadius: 4, padding: '1px 6px',
              outline: 'none', fontFamily: 'inherit', marginRight: 8, minWidth: 0, width: 160,
            }}
          />
        ) : (
          <span
            className="status-text"
            title="Double-click to rename"
            onDoubleClick={startEdit}
            style={{ marginRight: 8, cursor: 'default', userSelect: 'none' }}
          >
            {session?.name ?? ''}
          </span>
        )}
        <StatChips sessionId={sessionId} send={send} />
        <div className="flex-1" />
        {tabBar && <div className="mr-2">{tabBar}</div>}
        <button
          title="Close session"
          onClick={handleClose}
          className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-white/5"
          style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Mobile bar: tab switcher only */}
      {onTabChange && (
        <div
          className="md:hidden flex items-center justify-center border-b shrink-0 py-1.5"
          style={{ borderColor: 'var(--border)' }}
        >
          {tabBar}
        </div>
      )}
    </>
  );
}
