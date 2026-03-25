import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, ScrollText, Palette, Zap, TerminalSquare, BrainCircuit, Keyboard, SquarePlus, Home } from 'lucide-react';
import { tildefy } from '../utils';
import useStore, { activeTerminalSend } from '../store';
import SessionList from './SessionList';
import LogsModal from './LogsModal';
import ThemeDialog from './ThemeDialog';
import CommandsDialog, { loadCommands } from './CommandsDialog';
import MemoryDialog from './MemoryDialog';
import ShortcutsDialog from './ShortcutsDialog';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface SidebarProps {
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
}

export default function Sidebar({ onConnect, send }: SidebarProps) {
  const wsStatus = useStore(s => s.wsStatus);
  const currentSessionId = useStore(s => s.currentSessionId);
  const sessions = useStore(s => s.sessions);
  const [showLogs, setShowLogs] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [commands, setCommands] = useState(loadCommands);
  const [version, setVersion] = useState<string | null>(null);
  const [hindsightUp, setHindsightUp] = useState<boolean | null>(null);
  const [sidebarW, setSidebarW] = useState(() => {
    try { return parseInt(localStorage.getItem('vipershell:sidebar-w') ?? '') || 256; } catch { return 256; }
  });
  const draggingRef = useRef(false);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarW;
    const handle = e.currentTarget as HTMLElement;
    handle.style.background = '#58a6ff';
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setSidebarW(Math.max(180, Math.min(500, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      draggingRef.current = false;
      handle.style.background = 'transparent';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setSidebarW(w => { try { localStorage.setItem('vipershell:sidebar-w', String(w)); } catch { /* ignore */ } return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarW]);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/hindsight/health');
        if (!cancelled) setHindsightUp(res.ok);
      } catch {
        if (!cancelled) setHindsightUp(false);
      }
    }
    check();
    const id = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const statusLabel = {
    connecting: 'Connecting\u2026',
    connected: 'Connected',
    disconnected: 'Disconnected',
  }[wsStatus] ?? 'Unknown';

  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(d => setVersion(d.version))
      .catch(() => setVersion('?'));
  }, []);

  return (
    <aside
      className="hidden md:flex flex-col shrink-0"
      style={{ width: sidebarW, background: 'var(--card)', borderRight: '1px solid var(--border)', position: 'relative' }}
    >
      <div
        onMouseDown={onDragStart}
        style={{
          position: 'absolute', top: 0, right: 0, width: 4, height: '100%',
          cursor: 'col-resize', zIndex: 20, background: 'transparent',
        }}
        onMouseEnter={e => { if (!draggingRef.current) (e.currentTarget as HTMLElement).style.background = '#58a6ff'; }}
        onMouseLeave={e => { if (!draggingRef.current) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      />
      <div
        className="flex items-center justify-between px-4 py-3.5 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="logo">vipershell {'\u{1F40D}'}</span>
      </div>

      <SessionList
        id="session-list"
        onConnect={onConnect}
        send={send}
      />

      <div
        className="flex items-center gap-2 px-4 py-2.5 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <span id="status-dot" className={`status-dot ${wsStatus}`} />
        <span id="status-text" className="status-text" style={{ flex: 1 }}>{statusLabel}</span>
        {hindsightUp !== null && (
          <span
            title={hindsightUp ? 'Hindsight running' : 'Hindsight not running'}
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${hindsightUp ? 'bg-green-500' : 'bg-red-500'}`}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="New session" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <SquarePlus size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuItem onClick={() => send({ type: 'create_session', path: null, from_session_id: currentSessionId })}>
              <Home size={14} />
              <span className="text-xs">Home</span>
            </DropdownMenuItem>
            {(() => {
              const username = sessions.find(s => s.username)?.username;
              const dirs = [...new Set(sessions.map(s => s.path).filter(Boolean))] as string[];
              return dirs.length > 0 && <>
                <DropdownMenuSeparator />
                {dirs.map(path => (
                  <DropdownMenuItem key={path} onClick={() => send({ type: 'create_session', path, from_session_id: currentSessionId })}>
                    <span className="truncate font-mono text-xs">{tildefy(path, username)}</span>
                  </DropdownMenuItem>
                ))}
              </>;
            })()}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={async () => {
              const res = await fetch('/api/pick-directory', { method: 'POST' });
              const { path } = await res.json();
              if (path) send({ type: 'create_session', path, from_session_id: currentSessionId });
            }}>
              Choose directory{'\u2026'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu onOpenChange={(open) => { if (open) setCommands(loadCommands()); }}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title="Saved commands" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Zap size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-52">
            {commands.length === 0
              ? <DropdownMenuItem disabled><span className="text-xs text-muted-foreground">No saved commands</span></DropdownMenuItem>
              : commands.map(c => (
                <DropdownMenuItem key={c.id} onClick={() => {
                  activeTerminalSend.current({ type: 'input', data: c.command + '\r' });
                }}>
                  <TerminalSquare size={13} />
                  <span className="truncate text-xs">{c.name}</span>
                </DropdownMenuItem>
              ))
            }
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowCommands(true)}>
              <Settings size={13} /> Manage commands{'\u2026'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title="Settings"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <Settings size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-48">
            <DropdownMenuLabel className="flex justify-between items-center text-xs">
              <span>vipershell {'\u{1F40D}'}</span>
              <span className="font-mono text-primary">v{version ?? '\u2026'}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowLogs(true)}>
              <ScrollText size={14} />
              Server Logs
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowThemes(true)}>
              <Palette size={14} />
              Theme
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowMemory(true)}>
              <BrainCircuit size={14} />
              Memory
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowShortcuts(true)}>
              <Keyboard size={14} />
              Keyboard Shortcuts
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
      {showThemes && <ThemeDialog onClose={() => setShowThemes(false)} />}
      {showMemory && <MemoryDialog onClose={() => setShowMemory(false)} />}
      {showCommands && <CommandsDialog onClose={() => { setShowCommands(false); setCommands(loadCommands()); }} />}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </aside>
  );
}
