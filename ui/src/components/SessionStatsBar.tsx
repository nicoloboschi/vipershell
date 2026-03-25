import { useEffect, useRef, useState } from 'react';
import { Trash2, SquareTerminal, GitBranch, FolderOpen, Search, ChevronDown, SplitSquareHorizontal, SplitSquareVertical, Grid2x2, Minus } from 'lucide-react';
import useStore from '../store';
import StatChips from './StatChips';
import ClaudeIcon from './ClaudeIcon';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { NOTES_SESSION_ID } from './PaneTerminal';
import type { Layout } from './TerminalGrid';

/** Append U+FE0E (text presentation selector) to characters that browsers render as emoji */
const forceTextPresentation = (s: string) =>
  s.replace(/[\u2022-\u3299\u{1F000}-\u{1FAFF}]/gu, m => m + '\uFE0E');

interface SessionStatsBarProps {
  sessionId: string | null;
  send: (msg: Record<string, unknown>) => void;
  activeTab: string;
  onTabChange?: ((tab: string) => void) | null;
  onConnect?: (id: string) => void;
  layout?: Layout;
  onLayoutChange?: (layout: Layout) => void;
}

export default function SessionStatsBar({ sessionId, send, activeTab, onTabChange, onConnect, layout, onLayoutChange }: SessionStatsBarProps) {
  const sessionMap   = useStore(s => s.sessionMap);
  const showConfirm  = useStore(s => s.showConfirm);
  const lastCommand  = useStore(s => sessionId ? (s.sessionLastCommand[sessionId] ?? null) : null);
  const [editing, setEditing]     = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => { setEditing(false); }, [sessionId]);

  if (!sessionId || sessionId === NOTES_SESSION_ID) return null;
  const session = sessionMap[sessionId];

  function startEdit() {
    setDraftName(session?.name ?? '');
    setEditing(true);
  }

  async function commitRename() {
    setEditing(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === session?.name) return;
    await fetch(`/api/sessions/${encodeURIComponent(sessionId!)}/rename`, {
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

  const layoutButtons = onLayoutChange && layout && (
    <div
      className="flex items-center shrink-0"
      style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}
    >
      {([
        { l: 'single' as Layout, icon: <Minus size={13} />, title: 'Single' },
        { l: 'horizontal' as Layout, icon: <SplitSquareHorizontal size={13} />, title: 'Split horizontal' },
        { l: 'vertical' as Layout, icon: <SplitSquareVertical size={13} />, title: 'Split vertical' },
        { l: 'quad' as Layout, icon: <Grid2x2 size={13} />, title: '2\u00d72 grid' },
      ] as const).map(({ l, icon, title }) => (
        <button
          key={l}
          title={title}
          onClick={() => onLayoutChange(l)}
          style={{
            display: 'flex', alignItems: 'center', padding: '2px 5px',
            background: layout === l ? 'var(--accent)' : 'none',
            border: 'none', borderRight: l !== 'quad' ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
            color: layout === l ? 'var(--foreground)' : 'var(--muted-foreground)',
          }}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  const sessionNameDropdown = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="status-text"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '2px 6px', borderRadius: 4,
            color: 'var(--foreground)', fontSize: 'inherit',
            fontFamily: 'inherit',
          }}
          title="Session info"
        >
          {session?.isClaudeCode ? <ClaudeIcon size={14} /> : <SquareTerminal size={14} style={{ opacity: 0.5 }} />}
          <span style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {forceTextPresentation(session?.name ?? '')}
          </span>
          <ChevronDown size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start">
        <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Rename */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, opacity: 0.6 }}>
              Session name
            </div>
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
                  fontSize: 12, color: 'var(--foreground)', background: 'var(--input)',
                  border: '1px solid var(--ring)', borderRadius: 4, padding: '3px 8px',
                  outline: 'none', fontFamily: 'inherit', width: '100%',
                }}
              />
            ) : (
              <button
                onClick={startEdit}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  fontSize: 12, color: 'var(--foreground)', background: 'none',
                  border: '1px solid transparent', borderRadius: 4, padding: '3px 8px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
                className="hover:bg-white/5"
                title="Click to rename"
              >
                {forceTextPresentation(session?.name ?? '')}
              </button>
            )}
          </div>
          {/* Last command */}
          {lastCommand && (
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, opacity: 0.6 }}>
                Last command
              </div>
              <div style={{
                fontSize: 11, color: 'var(--foreground)',
                fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                opacity: 0.8, wordBreak: 'break-all',
                maxHeight: 80, overflow: 'auto',
              }}>
                {lastCommand}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <>
      {/* Desktop: 2 rows */}
      <div className="hidden md:flex flex-col shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
        {/* Row 1: session identity + stats */}
        <div className="flex items-center gap-1.5 px-4 py-1.5">
          {sessionNameDropdown}
          <StatChips sessionId={sessionId} send={send} />
          <div className="flex-1" />
          <button
            title="Close session"
            onClick={handleClose}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-white/5"
            style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
          >
            <Trash2 size={13} />
          </button>
        </div>
        {/* Row 2: layout switcher + tab bar */}
        <div
          className="flex items-center gap-2 px-4 py-1"
          style={{ borderTop: '1px solid var(--border)', opacity: 0.95 }}
        >
          {layoutButtons && <div>{layoutButtons}</div>}
          <div className="flex-1" />
          {tabBar && <div>{tabBar}</div>}
        </div>
      </div>

      {/* Mobile: tab bar only */}
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
