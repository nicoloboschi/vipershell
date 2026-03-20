import { useState, useEffect } from 'react';
import { Settings, ScrollText, Palette, SquarePlus, Home, Zap, TerminalSquare, BrainCircuit } from 'lucide-react';
import { tildefy } from '../utils.js';
import useStore from '../store.js';
import SessionList from './SessionList.jsx';
import LogsModal from './LogsModal.jsx';
import ThemeDialog from './ThemeDialog.jsx';
import MemoryDialog from './MemoryDialog.jsx';
import CommandsDialog, { loadCommands } from './CommandsDialog.jsx';
import { Button } from './ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx';

export default function Sidebar({ onConnect, send }) {
  const wsStatus = useStore(s => s.wsStatus);
  const currentSessionId = useStore(s => s.currentSessionId);
  const sessionMap = useStore(s => s.sessionMap);
  const sessions = useStore(s => s.sessions);
  const [showLogs, setShowLogs] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [commands, setCommands] = useState(loadCommands);
  const [version, setVersion] = useState(null);
  const [hindsightUp, setHindsightUp] = useState(null); // null=unknown, true, false

  const statusLabel = {
    connecting: 'Connecting…',
    connected: 'Connected',
    disconnected: 'Disconnected',
  }[wsStatus] ?? 'Unknown';

  // Fetch version once
  useEffect(() => {
    fetch('/api/version')
      .then(r => r.json())
      .then(d => setVersion(d.version))
      .catch(() => setVersion('?'));
  }, []);

  // Poll Hindsight health every 10s
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

  return (
    <aside
      className="hidden md:flex flex-col w-64 shrink-0 border-r"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3.5 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="logo">vipershell 🐍</span>
      </div>

      {/* Session list */}
      <SessionList
        id="session-list"
        onConnect={onConnect}
        send={send}
      />

      {/* Status bar */}
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
            <Button
              variant="ghost"
              size="icon"
              title="New session"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
            >
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
              const dirs = [...new Set(sessions.map(s => s.path).filter(Boolean))];
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
              Choose directory…
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
                  if (currentSessionId) send({ type: 'input', data: c.command + '\r' });
                }}>
                  <TerminalSquare size={13} />
                  <span className="truncate text-xs">{c.name}</span>
                </DropdownMenuItem>
              ))
            }
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setShowCommands(true)}>
              <Settings size={13} /> Manage commands…
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
              <span>vipershell 🐍</span>
              <span className="font-mono text-primary">v{version ?? '…'}</span>
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
      {showThemes && <ThemeDialog onClose={() => setShowThemes(false)} />}
      {showMemory && <MemoryDialog onClose={() => setShowMemory(false)} />}
      {showCommands && <CommandsDialog onClose={() => { setShowCommands(false); setCommands(loadCommands()); }} />}
    </aside>
  );
}
