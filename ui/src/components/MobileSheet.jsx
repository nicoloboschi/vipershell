import { useRef, useEffect, useState } from 'react';
import { Home, SquarePlus, Zap, TerminalSquare, Settings, ScrollText, Palette, BrainCircuit } from 'lucide-react';
import useStore from '../store.js';
import { tildefy } from '../utils.js';
import SessionList from './SessionList.jsx';
import CommandsDialog, { loadCommands } from './CommandsDialog.jsx';
import LogsModal from './LogsModal.jsx';
import ThemeDialog from './ThemeDialog.jsx';
import MemoryDialog from './MemoryDialog.jsx';
import { Button } from './ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.jsx';

/**
 * Mobile bottom sheet with drag-to-dismiss via drag pill.
 * @param {{
 *   onConnect: (id: string) => void,
 *   send: (msg: object) => void,
 * }} props
 */
export default function MobileSheet({ onConnect, send }) {
  const sheetOpen = useStore(s => s.sheetOpen);
  const setSheetOpen = useStore(s => s.setSheetOpen);
  const sessions = useStore(s => s.sessions);
  const currentSessionId = useStore(s => s.currentSessionId);
  const [showCommands, setShowCommands] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [commands, setCommands] = useState(loadCommands);

  const sheetRef = useRef(null);
  const backdropRef = useRef(null);
  const dragStartYRef = useRef(0);

  // Apply open/close transform
  useEffect(() => {
    const sheet = sheetRef.current;
    const backdrop = backdropRef.current;
    if (!sheet || !backdrop) return;

    sheet.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    if (sheetOpen) {
      sheet.style.transform = 'translateY(0)';
      backdrop.style.opacity = '1';
      backdrop.style.pointerEvents = 'auto';
    } else {
      sheet.style.transform = 'translateY(100%)';
      backdrop.style.opacity = '0';
      backdrop.style.pointerEvents = 'none';
    }
  }, [sheetOpen]);

  const handleDragStart = (e) => {
    dragStartYRef.current = e.touches[0].clientY;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  };

  const handleDragMove = (e) => {
    const dy = Math.max(0, e.touches[0].clientY - dragStartYRef.current);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
    if (backdropRef.current) {
      backdropRef.current.style.opacity = String(Math.max(0, 1 - dy / 200));
    }
  };

  const handleDragEnd = (e) => {
    const dy = e.changedTouches[0].clientY - dragStartYRef.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.32,0.72,0,1)';
    }
    if (dy > 80) {
      setSheetOpen(false);
    } else {
      setSheetOpen(true);
    }
  };

  const handleConnect = (id) => {
    onConnect(id);
    setSheetOpen(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="md:hidden fixed inset-0 z-40 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.5)',
          opacity: 0,
          transition: 'opacity 0.3s',
        }}
        onClick={() => setSheetOpen(false)}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        id="bottom-sheet"
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl border-t border-x"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--border)',
          maxHeight: '70vh',
          transform: 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32,0.72,0,1)',
        }}
      >
        {/* Drag pill */}
        <div
          id="sheet-drag-handle"
          className="flex justify-center pt-3 pb-2 shrink-0 cursor-grab"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
        >
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {showCommands && <CommandsDialog onClose={() => { setShowCommands(false); setCommands(loadCommands()); }} />}
        {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
        {showThemes && <ThemeDialog onClose={() => setShowThemes(false)} />}
        {showMemory && <MemoryDialog onClose={() => setShowMemory(false)} />}

        {/* Sheet header */}
        <div className="flex items-center justify-between px-4 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="logo">Sessions</span>
          </div>
          <div className="flex items-center gap-1">
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
                    if (currentSessionId) { send({ type: 'input', data: c.command + '\r' }); setSheetOpen(false); }
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
              <Button variant="ghost" size="icon" title="Settings" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                <Settings size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-48">
              <DropdownMenuLabel className="text-xs">vipershell 🐍</DropdownMenuLabel>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="New session" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                <SquarePlus size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuItem onClick={() => { send({ type: 'create_session', path: null }); setSheetOpen(false); }}>
                <Home size={14} />
                <span className="text-xs">Home</span>
              </DropdownMenuItem>
              {(() => {
                const username = sessions.find(s => s.username)?.username;
                const dirs = [...new Set(sessions.map(s => s.path).filter(Boolean))];
                return dirs.length > 0 && <>
                  <DropdownMenuSeparator />
                  {dirs.map(path => (
                    <DropdownMenuItem key={path} onClick={() => { send({ type: 'create_session', path }); setSheetOpen(false); }}>
                      <span className="truncate font-mono text-xs">{tildefy(path, username)}</span>
                    </DropdownMenuItem>
                  ))}
                </>;
              })()}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => {
                const res = await fetch('/api/pick-directory', { method: 'POST' });
                const { path } = await res.json();
                if (path) { send({ type: 'create_session', path }); setSheetOpen(false); }
              }}>
                Choose directory…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>

        {/* Session list */}
        <SessionList
          id="sheet-session-list"
          onConnect={handleConnect}
          send={send}
        />
      </div>
    </>
  );
}
