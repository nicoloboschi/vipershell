import { useEffect, useRef, useCallback, useState } from 'react';
import type { Terminal } from 'xterm';
import useStore from './store';
import { requestNotificationPermission } from './utils';
import { applyTheme } from './themes';
import { useWebSocket } from './hooks/useWebSocket';
import Sidebar from './components/Sidebar';
import PaneTerminal from './components/PaneTerminal';
import MobileKeybar from './components/MobileKeybar';
import ConfirmDialog from './components/ConfirmDialog';
import LogsModal from './components/LogsModal';
import ThemeDialog from './components/ThemeDialog';
import MemoryDialog from './components/MemoryDialog';
import CommandsDialog, { loadCommands } from './components/CommandsDialog';
import SessionList from './components/SessionList';
import { Button } from './components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import {
  Settings, ScrollText, Palette, ChevronDown, SquarePlus,
  Home, Zap, TerminalSquare, BrainCircuit,
} from 'lucide-react';
import { tildefy } from './utils';

// ── Pane layout persistence ──────────────────────────────────────────────────

function loadPanes(): (string | null)[] {
  try {
    const saved = JSON.parse(localStorage.getItem('vipershell-panes') || 'null');
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 3) return saved;
  } catch { /* ignore */ }
  const last = localStorage.getItem('vipershell-last-session');
  return [last || null];
}

// ── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [panes, setPanes]             = useState<(string | null)[]>(loadPanes);
  const [activePaneIndex, _setActive] = useState(0);

  const panesRef         = useRef(panes);
  const activePaneIdxRef = useRef(activePaneIndex);
  useEffect(() => { panesRef.current = panes; }, [panes]);
  useEffect(() => { activePaneIdxRef.current = activePaneIndex; }, [activePaneIndex]);

  const pane0SendRef  = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const pane0TermRef  = useRef<Terminal | null>(null);
  const fitAddonRef   = useRef({ fit: () => {} });
  const paneTabsRef   = useRef<((dir: 'left' | 'right') => void)[]>([]);

  useEffect(() => {
    localStorage.setItem('vipershell-panes', JSON.stringify(panes));
    useStore.getState().setOpenPaneMap(panes);
  }, [panes]);

  const activePaneSession = panes[activePaneIndex] ?? null;
  useEffect(() => {
    useStore.getState().setCurrentSessionId(activePaneSession);
  }, [activePaneSession]);

  const setActivePaneIndex = useCallback((index: number) => {
    _setActive(index);
    const sid = panesRef.current[index];
    if (sid) useStore.getState().setCurrentSessionId(sid);
  }, []);

  const connectPaneToSession = useCallback((paneIndex: number, sessionId: string | null) => {
    const existingIdx = panesRef.current.indexOf(sessionId);
    if (sessionId && existingIdx !== -1 && existingIdx !== paneIndex) {
      setActivePaneIndex(existingIdx);
      return;
    }
    setPanes(prev => {
      const next = [...prev];
      next[paneIndex] = sessionId;
      return next;
    });
    if (paneIndex === activePaneIdxRef.current) {
      useStore.getState().setCurrentSessionId(sessionId);
      if (sessionId) localStorage.setItem('vipershell-last-session', sessionId);
    }
  }, [setActivePaneIndex]);

  const connectSession = useCallback((sessionId: string) => {
    connectPaneToSession(activePaneIdxRef.current, sessionId);
  }, [connectPaneToSession]);

  const handlePaneSessionChange = useCallback((paneIndex: number, sessionId: string) => {
    connectPaneToSession(paneIndex, sessionId);
    setActivePaneIndex(paneIndex);
  }, [connectPaneToSession, setActivePaneIndex]);

  const handleRemovePane = useCallback((index: number) => {
    setPanes(prev => {
      const next = prev.filter((_, i) => i !== index);
      _setActive(p => Math.min(p, next.length - 1));
      return next;
    });
  }, []);

  const setPaneCount = useCallback((count: number) => {
    setPanes(prev => {
      if (count === prev.length) return prev;
      if (count > prev.length) return [...prev, ...Array(count - prev.length).fill(null)];
      _setActive(p => Math.min(p, count - 1));
      return prev.slice(0, count);
    });
  }, []);

  const addSessionToPane = useCallback((sessionId: string) => {
    const existingIdx = panesRef.current.indexOf(sessionId);
    if (existingIdx !== -1) {
      setActivePaneIndex(existingIdx);
      return;
    }
    setPanes(prev => {
      const emptyIdx = prev.indexOf(null);
      if (emptyIdx !== -1) {
        const next = [...prev];
        next[emptyIdx] = sessionId;
        return next;
      }
      if (prev.length < 3) return [...prev, sessionId];
      return prev;
    });
  }, [setActivePaneIndex]);

  const handleMessage = useCallback((msg: Record<string, unknown>) => {
    const store = useStore.getState();
    switch (msg.type) {
      case 'sessions': {
        store.renderSessions(msg.sessions as any); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!panesRef.current[0] && (msg.sessions as any[]).length > 0) {
          const lastId = localStorage.getItem('vipershell-last-session');
          const sessions = msg.sessions as any[];
          const target = (lastId && sessions.find((s: any) => s.id === lastId)) ?? sessions[0];
          if (target) connectPaneToSession(0, target.id);
        }
        break;
      }
      case 'session_created':
        connectSession(msg.session_id as string);
        break;
      case 'preview':
        store.updatePreview(msg.session_id as string, msg.preview as string, msg.busy as boolean | undefined);
        break;
      default: break;
    }
  }, [connectSession, connectPaneToSession]);

  const handleOpen = useCallback(() => {
    sendRef.current({ type: 'list_sessions' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { sendRef } = useWebSocket({ onMessage: handleMessage, onOpen: handleOpen });
  const send = useCallback((msg: Record<string, unknown>) => sendRef.current(msg), [sendRef]);

  useEffect(() => { applyTheme(useStore.getState().theme); }, []); // eslint-disable-line
  useEffect(() => {
    document.addEventListener('click', requestNotificationPermission, { once: true });
    return () => document.removeEventListener('click', requestNotificationPermission);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let lastH = 0;
    const update = () => {
      const h = vv.height + vv.offsetTop;
      if (document.querySelector('[data-radix-popper-content-wrapper],[data-radix-dialog-content]')) return;
      if (Math.abs(h - lastH) < 10 && lastH !== 0) return;
      lastH = h;
      document.documentElement.style.setProperty('--vvh', `${h}px`);
      setTimeout(() => {
        fitAddonRef.current?.fit();
        const term = pane0TermRef.current;
        const sid  = useStore.getState().currentSessionId;
        if (term && sid) pane0SendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
      }, 270);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []); // eslint-disable-line

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextId = useStore.getState().navigateSession(e.key === 'ArrowUp' ? 'up' : 'down');
        if (nextId) connectSession(nextId);
        return;
      }
      if (e.key === 'n') {
        e.preventDefault();
        const { currentSessionId, sessionMap } = useStore.getState();
        const path = currentSessionId ? (sessionMap[currentSessionId]?.path ?? null) : null;
        sendRef.current({ type: 'create_session', path, from_session_id: currentSessionId });
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        paneTabsRef.current[activePaneIdxRef.current]?.(e.key === 'ArrowRight' ? 'right' : 'left');
        return;
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [connectSession]); // eslint-disable-line

  return (
    <div
      className="flex overflow-hidden"
      style={{
        height: 'var(--vvh, 100dvh)', transition: 'height 0.25s ease',
        background: '#0d1117', color: '#c9d1d9',
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", fontSize: 13,
      }}
    >
      <Sidebar onConnect={connectSession} send={send} paneCount={panes.length} onPaneCountChange={setPaneCount} onAddToPane={addSessionToPane} />

      <div className="flex flex-col flex-1 min-w-0">
        <MobileTopBar onConnect={connectSession} send={send} />

        <div className="flex flex-row flex-1 min-h-0">
          {panes.map((sessionId, index) => (
            <PaneTerminal
              key={`pane-${index}`}
              paneIndex={index}
              sessionId={sessionId}
              isActive={activePaneIndex === index}
              onActivate={() => setActivePaneIndex(index)}
              onSessionChange={handlePaneSessionChange}
              showHeader={panes.length > 1}
              onRemovePane={panes.length > 1 ? handleRemovePane : null}
              onSendReady={index === 0 ? (_: number, fn: (msg: Record<string, unknown>) => void) => { pane0SendRef.current = fn; } : undefined}
              onTermReady={index === 0 ? (_: number, t: Terminal) => { pane0TermRef.current = t; } : undefined}
              onTabReady={(i: number, fn: (dir: 'left' | 'right') => void) => { paneTabsRef.current[i] = fn; }}
              className={index > 0 ? 'hidden md:flex' : undefined}
              send={send}
            />
          ))}
        </div>

        <MobileKeybar sendRef={pane0SendRef} termRef={pane0TermRef} />
      </div>

      <ConfirmDialog />
    </div>
  );
}

// ── MobileTopBar ──────────────────────────────────────────────────────────────

interface MobileTopBarProps {
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
}

function MobileTopBar({ onConnect, send }: MobileTopBarProps) {
  const wsStatus         = useStore(s => s.wsStatus);
  const currentSessionId = useStore(s => s.currentSessionId);
  const sessionMap       = useStore(s => s.sessionMap);
  const sessions         = useStore(s => s.sessions);
  const sessionOrder     = useStore(s => s.sessionOrder);
  const sessionIdx       = sessionOrder.indexOf(currentSessionId!);
  const swipeTouchRef    = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    swipeTouchRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swipeTouchRef.current) return;
    const dx = e.changedTouches[0]!.clientX - swipeTouchRef.current.x;
    const dy = e.changedTouches[0]!.clientY - swipeTouchRef.current.y;
    swipeTouchRef.current = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const nextId = useStore.getState().navigateSession(dx < 0 ? 'down' : 'up');
    if (nextId) onConnect(nextId);
  }, [onConnect]);

  const [showSessions, setShowSessions] = useState(false);
  const [showLogs,     setShowLogs]     = useState(false);
  const [showThemes,   setShowThemes]   = useState(false);
  const [showMemory,   setShowMemory]   = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [commands,     setCommands]     = useState(loadCommands);
  const [version,      setVersion]      = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version').then(r => r.json()).then(d => setVersion(d.version)).catch(() => {});
  }, []);

  const session  = currentSessionId ? sessionMap[currentSessionId] : undefined;
  const username = sessions.find(s => s.username)?.username;

  return (
    <>
      <header
        className="md:hidden flex flex-col shrink-0 border-b"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center gap-1 px-2" style={{ height: 48 }}>
          <span className={`status-dot ${wsStatus} shrink-0`} style={{ marginLeft: 4, marginRight: 2 }} />
          <button
            onClick={() => setShowSessions(true)}
            className="flex items-center gap-1 flex-1 min-w-0 rounded-md px-2 py-1 hover:bg-accent text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {sessionIdx >= 0 && (
              <span style={{ fontSize: 10, color: 'var(--muted-foreground)', fontWeight: 600, flexShrink: 0 }}>
                #{sessionIdx + 1}
              </span>
            )}
            <span key={currentSessionId} className="session-name-slide flex-1 min-w-0 truncate" style={{ fontSize: 13 }}>
              {session ? session.name : 'No session'}
            </span>
            {session?.path && (
              <span className="session-path shrink-0" style={{ fontSize: 10, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tildefy(session.path, username)}
              </span>
            )}
            <ChevronDown size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
          </button>

          <DropdownMenu onOpenChange={(open) => { if (open) setCommands(loadCommands()); }}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                <Zap size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-52">
              {commands.length === 0
                ? <DropdownMenuItem disabled><span className="text-xs text-muted-foreground">No saved commands</span></DropdownMenuItem>
                : commands.map(c => (
                  <DropdownMenuItem key={c.id} onClick={() => {
                    if (currentSessionId) send({ type: 'input', data: c.command + '\r' });
                  }}>
                    <TerminalSquare size={13} /><span className="truncate text-xs">{c.name}</span>
                  </DropdownMenuItem>
                ))
              }
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowCommands(true)}>
                <Settings size={13} /> Manage commands&hellip;
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                <SquarePlus size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-52">
              <DropdownMenuItem onClick={() => send({ type: 'create_session', path: null })}>
                <Home size={14} /><span className="text-xs">Home</span>
              </DropdownMenuItem>
              {(() => {
                const dirs = [...new Set(sessions.map(s => s.path).filter(Boolean))] as string[];
                return dirs.length > 0 && <>
                  <DropdownMenuSeparator />
                  {dirs.map(path => (
                    <DropdownMenuItem key={path} onClick={() => send({ type: 'create_session', path })}>
                      <span className="truncate font-mono text-xs">{tildefy(path, username)}</span>
                    </DropdownMenuItem>
                  ))}
                </>;
              })()}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => {
                const res = await fetch('/api/pick-directory', { method: 'POST' });
                const { path } = await res.json();
                if (path) send({ type: 'create_session', path });
              }}>
                Choose directory&hellip;
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground">
                <Settings size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-48">
              <DropdownMenuLabel className="flex justify-between items-center text-xs">
                <span>vipershell {'\u{1F40D}'}</span>
                <span className="font-mono text-primary">v{version ?? '\u2026'}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowLogs(true)}>
                <ScrollText size={14} /> Server Logs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowThemes(true)}>
                <Palette size={14} /> Theme
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowMemory(true)}>
                <BrainCircuit size={14} /> Memory
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {sessionOrder.length > 1 && (
          <div className="flex items-center justify-center gap-1.5 pb-1.5">
            {sessionOrder.length <= 12
              ? sessionOrder.map((id, i) => (
                  <span key={id} style={{
                    width: i === sessionIdx ? 16 : 5, height: 5, borderRadius: 3,
                    background: i === sessionIdx ? 'var(--primary)' : 'var(--border)',
                    transition: 'width 0.25s ease, background 0.25s ease', flexShrink: 0,
                  }} />
                ))
              : <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>{sessionIdx + 1} / {sessionOrder.length}</span>
            }
          </div>
        )}
      </header>

      {showSessions && (
        <>
          <div className="md:hidden fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSessions(false)} />
          <div className="md:hidden fixed left-0 right-0 z-50 flex flex-col rounded-b-2xl border-b border-x overflow-hidden"
            style={{ top: 48, maxHeight: '65vh', background: 'var(--card)', borderColor: 'var(--border)' }}>
            <div className="px-4 py-3 border-b shrink-0 flex items-center" style={{ borderColor: 'var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>Sessions</span>
            </div>
            <SessionList
              id="topbar-session-list"
              onConnect={(id) => { onConnect(id); setShowSessions(false); }}
              send={send}
            />
          </div>
        </>
      )}

      {showLogs     && <LogsModal     onClose={() => setShowLogs(false)} />}
      {showThemes   && <ThemeDialog   onClose={() => setShowThemes(false)} />}
      {showMemory   && <MemoryDialog  onClose={() => setShowMemory(false)} />}
      {showCommands && <CommandsDialog onClose={() => { setShowCommands(false); setCommands(loadCommands()); }} />}
    </>
  );
}
