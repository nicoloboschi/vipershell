import { useState, useCallback, useEffect, useRef } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Loader2 } from 'lucide-react';
import TerminalCell from './TerminalCell';
import useStore from '../store';

export type Layout = 'single' | 'horizontal' | 'vertical' | 'quad';

interface TerminalGridProps {
  /** Primary session ID for the first cell */
  sessionId: string;
  /** Callback to create a child session in the same dir. Returns the new session ID. */
  onCreateSplit: () => Promise<string | null>;
  /** Called when a child session should be closed */
  onCloseSplit?: (sessionId: string) => void;
  /** Called when a file link is clicked in the terminal */
  onFileLinkClick?: (path: string) => void;
  /** Exposes layout state and change handler to parent */
  onLayoutReady?: (info: { layout: Layout; changeLayout: (l: Layout) => void }) => void;
}

const LS_KEY = 'vipershell:term-grid';

function loadGridState(sessionId: string): { layout: Layout; cells: string[] } | null {
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return map[sessionId] ?? null;
  } catch { return null; }
}

function saveGridState(sessionId: string, layout: Layout, cells: string[]): void {
  try {
    const map = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    map[sessionId] = { layout, cells };
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export default function TerminalGrid({ sessionId, onCreateSplit, onCloseSplit, onFileLinkClick, onLayoutReady }: TerminalGridProps) {
  const [layout, setLayout] = useState<Layout>('single');
  // cells: string = session ID, null = loading placeholder
  const [cells, setCells] = useState<(string | null)[]>([sessionId]);
  const [activeCell, setActiveCell] = useState(0);
  const pendingRef = useRef(0); // track in-flight split creations

  // Reset when session changes; clean up old splits
  useEffect(() => {
    const saved = loadGridState(sessionId);
    if (saved && saved.cells.length > 0 && saved.cells[0] === sessionId) {
      setLayout(saved.layout);
      setCells(saved.cells);
      // Re-register split sessions
      for (let i = 1; i < saved.cells.length; i++) {
        if (saved.cells[i]) useStore.getState().addSplitSession(saved.cells[i]!);
      }
    } else {
      setLayout('single');
      setCells([sessionId]);
    }
    setActiveCell(0);

    // Cleanup: unregister splits when switching away
    return () => {
      const stored = loadGridState(sessionId);
      if (stored) {
        for (let i = 1; i < stored.cells.length; i++) {
          if (stored.cells[i]) useStore.getState().removeSplitSession(stored.cells[i]!);
        }
      }
    };
  }, [sessionId]);

  // Persist grid state (only if no loading placeholders)
  useEffect(() => {
    if (cells.every(c => c !== null)) {
      saveGridState(sessionId, layout, cells as string[]);
    }
  }, [sessionId, layout, cells]);

  const addSplit = useCallback(async (newLayout: Layout) => {
    const needed = layoutCellCount(newLayout);
    const currentCells = [...cells];

    // Remove excess cells first
    while (currentCells.length > needed) {
      const removed = currentCells.pop()!;
      if (removed && removed !== sessionId) {
        useStore.getState().removeSplitSession(removed);
        onCloseSplit?.(removed);
      }
    }

    // If we need more, set layout immediately with null placeholders (shows loading)
    const toCreate = needed - currentCells.length;
    for (let i = 0; i < toCreate; i++) currentCells.push(null);

    setCells(currentCells);
    setLayout(newLayout);

    // Create sessions in background
    if (toCreate > 0) {
      pendingRef.current += toCreate;
      for (let i = needed - toCreate; i < needed; i++) {
        const idx = i;
        onCreateSplit().then(newId => {
          pendingRef.current--;
          if (newId) {
            setCells(prev => {
              const next = [...prev];
              next[idx] = newId;
              return next;
            });
          }
        });
      }
    }
  }, [cells, sessionId, onCreateSplit, onCloseSplit]);

  // Expose layout state to parent
  useEffect(() => {
    onLayoutReady?.({ layout, changeLayout: addSplit });
  }, [layout, addSplit, onLayoutReady]);

  const closeCell = useCallback((index: number) => {
    if (cells.length <= 1) return;
    const removed = cells[index];

    // Close the split session on the server and unregister it
    if (removed && removed !== sessionId) {
      useStore.getState().removeSplitSession(removed);
      onCloseSplit?.(removed);
    }

    const newCells = cells.filter((_, i) => i !== index);

    // Determine new layout
    let newLayout: Layout = 'single';
    if (newCells.length === 2) newLayout = layout === 'quad' ? 'horizontal' : layout;
    if (newCells.length === 3) newLayout = 'quad';
    if (newCells.length >= 4) newLayout = 'quad';

    setCells(newCells);
    setLayout(newLayout);
    setActiveCell(prev => Math.min(prev, newCells.length - 1));

    // Persist immediately
    if (newCells.every(c => c !== null)) {
      saveGridState(sessionId, newLayout, newCells as string[]);
    }
  }, [cells, sessionId, layout, onCloseSplit]);


  const renderCell = (index: number) => {
    const sid = cells[index];
    // Loading placeholder
    if (sid === null || sid === undefined) {
      return (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0d1117', color: 'var(--muted-foreground)',
          minHeight: 0, minWidth: 0,
        }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      );
    }
    return (
      <TerminalCell
        key={sid}
        sessionId={sid}
        isActive={activeCell === index}
        onActivate={() => setActiveCell(index)}
        onClose={cells.length > 1 ? () => closeCell(index) : null}
        onFileLinkClick={onFileLinkClick}
      />
    );
  };

  const handle = (dir: 'horizontal' | 'vertical') => (
    <PanelResizeHandle
      className={`terminal-resize-handle terminal-resize-handle-${dir}`}
    />
  );

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, position: 'relative' }}>
      {layout === 'single' && renderCell(0)}

      {layout === 'horizontal' && (
        <PanelGroup orientation="horizontal" style={{ flex: 1, display: 'flex' }}>
          <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(0)}</Panel>
          {handle('horizontal')}
          <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(1)}</Panel>
        </PanelGroup>
      )}

      {layout === 'vertical' && (
        <PanelGroup orientation="vertical" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(0)}</Panel>
          {handle('vertical')}
          <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(1)}</Panel>
        </PanelGroup>
      )}

      {layout === 'quad' && (
        <PanelGroup orientation="horizontal" style={{ flex: 1, display: 'flex' }}>
          <Panel minSize={15} style={{ display: 'flex' }}>
            <PanelGroup orientation="vertical" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(0)}</Panel>
              {handle('vertical')}
              <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(2)}</Panel>
            </PanelGroup>
          </Panel>
          {handle('horizontal')}
          <Panel minSize={15} style={{ display: 'flex' }}>
            <PanelGroup orientation="vertical" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(1)}</Panel>
              {handle('vertical')}
              <Panel minSize={15} style={{ display: 'flex' }}>{renderCell(3)}</Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}

function layoutCellCount(layout: Layout): number {
  switch (layout) {
    case 'single': return 1;
    case 'horizontal': return 2;
    case 'vertical': return 2;
    case 'quad': return 4;
  }
}
