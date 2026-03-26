import { useEffect, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useStore from '../store';
import SessionStatsBar from './SessionStatsBar';
import GitDiffPane from './GitDiffPane';
import FilesPane, { SearchPanel } from './FilesPane';
import NotesPane from './NotesPane';
import TerminalGrid from './TerminalGrid';
import type { Layout } from './TerminalGrid';

export const NOTES_SESSION_ID = '__notes__';

const TABS = ['terminal', 'diff', 'files', 'search'] as const;
type TabType = typeof TABS[number];

interface PaneTerminalProps {
  sessionId: string | null;
  send: (msg: Record<string, unknown>) => void;
  onTabReady?: (fn: (dir: 'left' | 'right') => void) => void;
  onConnect?: (id: string) => void;
}

export default function PaneTerminal({ sessionId, send, onTabReady, onConnect }: PaneTerminalProps): JSX.Element {
  const openFileRef      = useRef<((path: string) => void) | null>(null);
  const [highlightQuery, setHighlightQuery] = useState<string | null>(null);
  const [highlightLine,  setHighlightLine]  = useState<number | null>(null);
  const [gridLayout, setGridLayout] = useState<Layout>('single');
  const changeLayoutRef = useRef<((l: Layout) => void) | null>(null);

  // Keep visited sessions mounted (hidden) for instant switching
  const allSessionIds = useStore(useShallow(s => s.sessions.map(ss => ss.id)));
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  useEffect(() => {
    if (!sessionId || sessionId === NOTES_SESSION_ID) return;
    setVisitedIds(prev => prev.includes(sessionId) ? prev : [...prev, sessionId]);
  }, [sessionId]);
  // Remove closed sessions from cache
  const activeVisited = visitedIds.filter(id => allSessionIds.includes(id));

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

  useEffect(() => {
    if (!sessionId) return;
    setActiveTab((readTabMap()[sessionId] as TabType) ?? 'terminal');
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sessionId) saveTab(sessionId, activeTab);
  }, [activeTab, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Expose cycleTab to parent
  useEffect(() => {
    onTabReady?.((dir: 'left' | 'right') => {
      setActiveTab((prev: TabType) => {
        const idx = TABS.indexOf(prev);
        const next = (idx + (dir === 'right' ? 1 : -1) + TABS.length) % TABS.length;
        return TABS[next]!;
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refit + refocus terminal when switching back to terminal tab
  useEffect(() => {
    if (activeTab === 'terminal') {
      // Small delay to let display:none→flex take effect so xterm can measure
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('vipershell:terminal-tab-active'));
      }, 50);
    }
  }, [activeTab]);

  // Restore last opened file when switching to files tab
  useEffect(() => {
    if (activeTab !== 'files') return;
    const last = sessionId ? getLastFile(sessionId) : null;
    if (last) setTimeout(() => openFileRef.current?.(last), 50);
  }, [activeTab, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionMap = useStore(s => s.sessionMap);

  // Create split: create a new session in the same directory via REST API
  const handleCreateSplit = useCallback(async (): Promise<string | null> => {
    if (!sessionId) return null;
    const session = sessionMap[sessionId];
    const path = session?.path ?? null;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (data.ok && data.session_id) {
        // Immediately register as split so it won't appear in session list
        useStore.getState().addSplitSession(data.session_id);
        // Refresh sessions list
        send({ type: 'list_sessions' });
        return data.session_id;
      }
      return null;
    } catch { return null; }
  }, [sessionId, sessionMap, send]);

  const handleFileLinkClick = useCallback(async (rawPath: string) => {
    let cleaned = rawPath;
    let line: number | null = null;
    const colonMatch = cleaned.match(/^(.+?)(?::(\d+)(?::\d+)?)\s*$/);
    const parenMatch = !colonMatch && cleaned.match(/^(.+?)\((\d+)(?:[,:]\d+)?\)\s*$/);
    if (colonMatch) { cleaned = colonMatch[1]!; line = parseInt(colonMatch[2]!, 10); }
    else if (parenMatch) { cleaned = parenMatch[1]!; line = parseInt(parenMatch[2]!, 10); }
    cleaned = cleaned.replace(/[.,;)'">\]]+$/, '');

    let absPath = cleaned;
    if (!cleaned.startsWith('/') && !cleaned.startsWith('~/') && sessionId) {
      try {
        const res = await fetch(`/api/fs/${encodeURIComponent(sessionId)}/browse`);
        const data = await res.json();
        const cwd = (data.cwd as string) ?? '';
        absPath = cwd ? `${cwd}/${cleaned.replace(/^\.\//, '')}` : cleaned;
      } catch { /* use cleaned as-is */ }
    }
    if (line) { setHighlightLine(line); setHighlightQuery(null); }
    setActiveTab('files');
    setTimeout(() => openFileRef.current?.(absPath), 50);
  }, [sessionId]);

  const isNotes = sessionId === NOTES_SESSION_ID;

  if (isNotes) {
    return (
      <div className="flex flex-col flex-1 min-w-0 min-h-0" style={{ position: 'relative' }}>
        <NotesPane />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0" style={{ position: 'relative' }}>
      <SessionStatsBar
        sessionId={sessionId}
        send={send}
        activeTab={activeTab}
        onTabChange={setActiveTab as (tab: string) => void}
        onConnect={onConnect}
        layout={gridLayout}
        onLayoutChange={(l) => changeLayoutRef.current?.(l)}
      />
      {activeVisited.map(vid => (
        <div
          key={vid}
          style={{
            display: activeTab === 'terminal' && vid === sessionId ? 'flex' : 'none',
            flex: 1, flexDirection: 'column', minHeight: 0,
          }}
        >
          <TerminalGrid
            sessionId={vid}
            onCreateSplit={handleCreateSplit}
            onFileLinkClick={handleFileLinkClick}
            onLayoutReady={vid === sessionId ? ({ layout: l, changeLayout }) => {
              setGridLayout(l);
              changeLayoutRef.current = changeLayout;
            } : undefined}
          />
        </div>
      ))}
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
