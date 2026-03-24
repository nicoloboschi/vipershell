import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { SerializeAddon } from 'xterm-addon-serialize';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { ChevronDown, X } from 'lucide-react';
import useStore from '../store';
import TerminalPane from './TerminalPane';
import SessionStatsBar from './SessionStatsBar';
import GitDiffPane from './GitDiffPane';
import FilesPane, { SearchPanel } from './FilesPane';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

// Strip alternate-screen switch sequences so xterm stays on the primary buffer.
// This lets the prefilled history scrollback remain accessible via normal scroll.
// TUI apps (vim, Claude Code, htop) still work — they draw inline on the primary
// buffer using absolute cursor positioning, which xterm handles correctly.
const filterAltScreen = (data: string): string =>
  data.replace(/\x1b\[\?(1049|47|1047)[hl]/g, '');

const TERMINAL_THEME = {
  background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', cursorAccent: '#0d1117',
  selectionBackground: 'rgba(88,166,255,0.3)',
  black: '#484f58', brightBlack: '#6e7681', red: '#ff7b72', brightRed: '#ffa198',
  green: '#3fb950', brightGreen: '#56d364', yellow: '#d29922', brightYellow: '#e3b341',
  blue: '#58a6ff', brightBlue: '#79c0ff', magenta: '#bc8cff', brightMagenta: '#d2a8ff',
  cyan: '#39c5cf', brightCyan: '#56d4dd', white: '#b1bac4', brightWhite: '#f0f6fc',
};

/**
 * A self-contained pane: own xterm instance + own WebSocket connection.
 * Handles terminal I/O independently of other panes.
 */
const TABS = ['terminal', 'diff', 'files', 'search'] as const;
type TabType = typeof TABS[number];

interface PaneTerminalProps {
  paneIndex: number;
  sessionId: string | null;
  isActive: boolean;
  onActivate: () => void;
  onSessionChange: (paneIndex: number, sessionId: string) => void;
  showHeader: boolean;
  onRemovePane: ((index: number) => void) | null;
  onSendReady?: (paneIndex: number, sendFn: (msg: Record<string, unknown>) => void) => void;
  onTermReady?: (paneIndex: number, term: Terminal) => void;
  onTabReady?: (paneIndex: number, fn: (dir: 'left' | 'right') => void) => void;
  className?: string;
  send: (msg: Record<string, unknown>) => void;
}

export default function PaneTerminal({
  paneIndex,
  sessionId,
  isActive,
  onActivate,
  onSessionChange,
  showHeader,
  onRemovePane,
  onSendReady,
  onTermReady,
  onTabReady,
  className,
  send,
}: PaneTerminalProps): JSX.Element {
  const openFileRef      = useRef<((path: string) => void) | null>(null);
  const [highlightQuery, setHighlightQuery] = useState<string | null>(null);
  const [highlightLine,  setHighlightLine]  = useState<number | null>(null);
  const fileLinkHandler  = useRef<((rawPath: string) => Promise<void>) | null>(null);
  const termRef          = useRef<Terminal | null>(null);
  const fitAddonRef      = useRef<FitAddon | null>(null);
  const serializeAddon   = useRef<SerializeAddon | null>(null);
  const sendRef          = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const sessionIdRef     = useRef<string | null>(sessionId);
  const pendingResetRef  = useRef<boolean>(false);
  const snapshotsRef     = useRef<Map<string, string>>(new Map());

  const LS_KEY      = 'vipershell:session-tabs';
  const LS_FILE_KEY = 'vipershell:session-last-file';

  function readTabMap(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }

  function saveTab(sid: string, tab: TabType): void {
    try {
      const map = readTabMap();
      map[sid] = tab;
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
  }

  function getLastFile(sid: string): string | null {
    try { return JSON.parse(localStorage.getItem(LS_FILE_KEY) || '{}')[sid] ?? null; } catch { return null; }
  }

  function saveLastFile(sid: string, path: string): void {
    try {
      const map: Record<string, string> = JSON.parse(localStorage.getItem(LS_FILE_KEY) || '{}');
      map[sid] = path;
      localStorage.setItem(LS_FILE_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
  }

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (!sessionId) return 'terminal';
    return (readTabMap()[sessionId] as TabType) ?? 'terminal';
  });

  // Restore saved tab when session changes
  useEffect(() => {
    if (!sessionId) return;
    setActiveTab((readTabMap()[sessionId] as TabType) ?? 'terminal');
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist tab whenever it changes
  useEffect(() => {
    if (sessionId) saveTab(sessionId, activeTab);
  }, [activeTab, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose cycleTab to parent for keyboard shortcut handling
  useEffect(() => {
    onTabReady?.(paneIndex, (dir: 'left' | 'right') => {
      setActiveTab((prev: TabType) => {
        const idx = TABS.indexOf(prev);
        const next = (idx + (dir === 'right' ? 1 : -1) + TABS.length) % TABS.length;
        return TABS[next]!;
      });
    });
  }, [paneIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep file-link handler current so it always sees latest sessionId + setActiveTab
  useEffect(() => {
    fileLinkHandler.current = async (rawPath: string): Promise<void> => {
      // Strip trailing :line:col suffix common in compiler output
      const path = rawPath.replace(/(:\d+)+$/, '').replace(/[.,;)'">\]]+$/, '');
      let absPath = path;
      if (!path.startsWith('/') && !path.startsWith('~/')) {
        try {
          const res  = await fetch(`/api/fs/${encodeURIComponent(sessionIdRef.current!)}/browse`);
          const data = await res.json();
          const cwd  = (data.cwd as string) ?? '';
          absPath = cwd ? `${cwd}/${path.replace(/^\.\//, '')}` : path;
        } catch { /* use rawPath as-is */ }
      }
      setActiveTab('files');
      setTimeout(() => openFileRef.current?.(absPath), 50);
    };
  }); // runs every render so it captures latest state

  const sessions    = useStore((s: any) => s.sessions);
  const sessionMap  = useStore((s: any) => s.sessionMap);

  // Create xterm once
  if (!termRef.current) {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fit      = new FitAddon();
    const serialize = new SerializeAddon();
    const links    = new WebLinksAddon((_: MouseEvent, url: string) => window.open(url, '_blank', 'noopener'));
    term.loadAddon(fit);
    term.loadAddon(serialize);
    term.loadAddon(links);
    termRef.current     = term;
    fitAddonRef.current = fit;
    serializeAddon.current = serialize;
    onTermReady?.(paneIndex, term);
  }

  // Register file-path link provider once after terminal is ready
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    // Match absolute paths (/foo/bar), home paths (~/foo), and relative paths (./foo, ../foo)
    // Exclude URLs (containing ://)
    const FILE_RE = /((?:~\/|\.\.?\/|\/(?![\s/]))[\w./\-@~+%:]+)/g;
    const provider = term.registerLinkProvider({
      provideLinks(y: number, callback: (links: any[]) => void): void {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) { callback([]); return; }
        const text = line.translateToString();
        const links: any[] = [];
        let match: RegExpExecArray | null;
        FILE_RE.lastIndex = 0;
        while ((match = FILE_RE.exec(text)) !== null) {
          const raw = match[1]!;
          if (raw.includes('://')) continue; // skip URLs
          const startX = match.index + 1;
          const endX   = match.index + raw.length;
          links.push({
            range: { start: { x: startX, y }, end: { x: endX, y } },
            text: raw,
            decorations: { underline: true, pointerCursor: true },
            activate(event: MouseEvent, linkText: string) { if (event?.metaKey || event?.ctrlKey) fileLinkHandler.current?.(linkText); },
          });
        }
        callback(links);
      },
    });
    return () => provider.dispose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Own WebSocket — does NOT update global wsStatus
  useEffect(() => {
    let mounted = true;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;

    function openWs(): void {
      if (!mounted) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);

      // Expose send immediately so sessionId effect can use it
      sendRef.current = (msg: Record<string, unknown>) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      };
      onSendReady?.(paneIndex, (msg: Record<string, unknown>) => sendRef.current(msg));

      ws.onopen = () => {
        if (!mounted) return;
        delay = 1000;
        fitAddonRef.current?.fit();
        if (sessionIdRef.current) {
          sendRef.current({ type: 'connect', session_id: sessionIdRef.current });
        }
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (!mounted) return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'sessions') {
          useStore.getState().renderSessions(msg.sessions);
        } else if (msg.type === 'preview') {
          useStore.getState().updatePreview(msg.session_id, msg.preview, msg.busy);
        } else if (msg.type === 'connected') {
          pendingResetRef.current = true;
          const term = termRef.current;
          if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
        } else if (msg.type === 'output') {
          const term = termRef.current;
          if (!term) return;
          if (pendingResetRef.current) {
            pendingResetRef.current = false;
            term.reset();
          }
          // Filter alternate-screen sequences to keep xterm on primary buffer
          term.write(filterAltScreen(msg.data));
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        retryTimer = setTimeout(() => {
          delay = Math.min(delay * 2, 30_000);
          openWs();
        }, delay);
      };
    }

    openWs();

    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect when sessionId prop changes
  useEffect(() => {
    const prev = sessionIdRef.current;
    sessionIdRef.current = sessionId;
    if (!sessionId) return;

    // Save snapshot of the old session before switching
    if (prev && prev !== sessionId && serializeAddon.current) {
      try { snapshotsRef.current.set(prev, serializeAddon.current.serialize()); } catch { /* ignore */ }
    }

    const term = termRef.current;
    if (term) {
      const cached = snapshotsRef.current.get(sessionId);
      term.reset();
      if (cached) {
        term.write(cached);
      } else {
        term.write('\x1b[?25l\r\nConnecting…\r\n');
      }
      // Re-fit after session switch so terminal dimensions match the container
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
      }, 0);
    }

    sendRef.current({ type: 'connect', session_id: sessionId });
  }, [sessionId]);

  // Restore last opened file when switching to files tab
  useEffect(() => {
    if (activeTab !== 'files') return;
    const last = sessionId ? getLastFile(sessionId) : null;
    if (last) setTimeout(() => openFileRef.current?.(last), 50);
  }, [activeTab, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refit + refocus when switching back to terminal tab
  useEffect(() => {
    if (activeTab === 'terminal') {
      fitAddonRef.current?.fit();
      termRef.current?.focus();
    }
  }, [activeTab]);

  // Focus when this pane becomes active
  useEffect(() => {
    if (isActive && activeTab === 'terminal') termRef.current?.focus();
  }, [isActive, activeTab]);

  const session = sessionMap[sessionId as string];

  return (
    <div
      className={`flex flex-col flex-1 min-w-0 min-h-0${className ? ` ${className}` : ''}`}
      style={{ borderLeft: paneIndex > 0 ? '1px solid var(--border)' : undefined, position: 'relative' }}
      onClick={onActivate}
    >
      {showHeader && (
        <div
          className="flex items-center shrink-0 px-2 gap-1"
          style={{
            height: 26,
            background: 'var(--card)',
            borderBottom: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="pane-header-btn"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{session?.name ?? sessionId ?? 'No session'}</span>
                <ChevronDown size={9} style={{ flexShrink: 0, color: 'var(--muted-foreground)' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {sessions.map((s: any) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => onSessionChange(paneIndex, s.id)}
                  style={{ opacity: s.id === sessionId ? 0.5 : 1 }}
                >
                  <span className="truncate text-xs">{s.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onRemovePane && (
            <button
              title="Close pane"
              onClick={(e) => { e.stopPropagation(); onRemovePane(paneIndex); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                color: 'var(--muted-foreground)', flexShrink: 0, display: 'flex', alignItems: 'center',
              }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      )}
      <SessionStatsBar
        sessionId={sessionId}
        send={send}
        activeTab={activeTab}
        onTabChange={setActiveTab as (tab: string) => void}
        onConnect={(id: string) => onSessionChange(paneIndex, id)}
      />
      <div style={{ display: activeTab === 'terminal' ? 'flex' : 'none', flex: 1, flexDirection: 'column', minHeight: 0 }}>
        <TerminalPane
          termRef={termRef}
          fitAddonRef={fitAddonRef}
          sendRef={sendRef}
          sessionId={sessionId}
        />
      </div>
      {activeTab === 'diff'   && <GitDiffPane sessionId={sessionId} onOpenFile={(path: string) => { setActiveTab('files'); setTimeout(() => openFileRef.current?.(path), 50); }} />}
      {activeTab === 'files'  && <FilesPane  sessionId={sessionId} openFileRef={openFileRef} onFileSelect={(path: string) => { saveLastFile(sessionId!, path); setHighlightQuery(null); setHighlightLine(null); }} highlightQuery={highlightQuery} highlightLine={highlightLine} />}
      {activeTab === 'search' && (
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, background: '#0d1117' }}>
          <SearchPanel sessionId={sessionId} onOpenFile={(path: string, query?: string, line?: number) => { setHighlightQuery(query ?? null); setHighlightLine(line ?? null); setActiveTab('files'); setTimeout(() => openFileRef.current?.(path), 50); }} />
        </div>
      )}
    </div>
  );
}
