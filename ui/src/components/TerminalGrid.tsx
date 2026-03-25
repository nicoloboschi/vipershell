import { useState, useCallback, useEffect, useRef } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Loader2 } from 'lucide-react';
import TerminalCell from './TerminalCell';
import useStore from '../store';

export type Layout = 'single' | 'horizontal' | 'vertical' | 'quad';

interface TerminalGridProps {
  sessionId: string;
  onCreateSplit: () => Promise<string | null>;
  onFileLinkClick?: (path: string) => void;
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

function layoutCellCount(layout: Layout): number {
  switch (layout) {
    case 'single': return 1;
    case 'horizontal': return 2;
    case 'vertical': return 2;
    case 'quad': return 4;
  }
}

export default function TerminalGrid({ sessionId, onCreateSplit, onFileLinkClick, onLayoutReady }: TerminalGridProps) {
  const [layout, setLayout] = useState<Layout>('single');
  // All cells ever created for this session. Index 0 is always the main session.
  // null = still being created. Sessions persist even when layout shrinks.
  const [cells, setCells] = useState<(string | null)[]>([sessionId]);
  const [activeCell, setActiveCell] = useState(0);
  const creatingRef = useRef(false);

  // Restore saved state when session changes
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

    return () => {
      // Unregister splits when switching away (they stay alive on the server)
      const stored = loadGridState(sessionId);
      if (stored) {
        for (let i = 1; i < stored.cells.length; i++) {
          if (stored.cells[i]) useStore.getState().removeSplitSession(stored.cells[i]!);
        }
      }
    };
  }, [sessionId]);

  // Persist grid state whenever cells are fully resolved
  useEffect(() => {
    if (cells.every(c => c !== null)) {
      saveGridState(sessionId, layout, cells as string[]);
    }
  }, [sessionId, layout, cells]);

  // Create any missing sessions in parallel
  const ensureCells = useCallback(async (needed: number) => {
    if (creatingRef.current) return;
    // Use functional state to get the latest cells
    setCells(currentCells => {
      const have = currentCells.length;
      if (have >= needed) return currentCells;

      const toCreate = needed - have;
      // Add null placeholders immediately
      const next = [...currentCells, ...Array(toCreate).fill(null) as null[]];

      // Create all in parallel
      creatingRef.current = true;
      const promises = Array.from({ length: toCreate }, (_, i) => {
        const idx = have + i;
        return onCreateSplit().then(newId => {
          if (newId) {
            setCells(prev => {
              const updated = [...prev];
              updated[idx] = newId;
              return updated;
            });
          }
        });
      });
      Promise.all(promises).finally(() => { creatingRef.current = false; });

      return next;
    });
  }, [onCreateSplit]);

  const changeLayout = useCallback((newLayout: Layout) => {
    setLayout(newLayout);
    const needed = layoutCellCount(newLayout);
    setActiveCell(prev => Math.min(prev, needed - 1));
    ensureCells(needed);
  }, [ensureCells]);

  // Expose layout state to parent
  useEffect(() => {
    onLayoutReady?.({ layout, changeLayout });
  }, [layout, changeLayout, onLayoutReady]);

  const visibleCount = layoutCellCount(layout);

  const renderCell = (index: number) => {
    const sid = cells[index];
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
        onFileLinkClick={onFileLinkClick}
      />
    );
  };

  const handle = (dir: 'horizontal' | 'vertical') => (
    <PanelResizeHandle
      className={`terminal-resize-handle terminal-resize-handle-${dir}`}
    />
  );

  // Render hidden cells so their WS connections stay alive
  const hiddenCells = cells.slice(visibleCount).filter((sid): sid is string => sid !== null);

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

      {/* Keep hidden split sessions alive (WS connected, just not visible) */}
      {hiddenCells.map(sid => (
        <div key={sid} style={{ display: 'none' }}>
          <TerminalCell
            sessionId={sid}
            isActive={false}
            onActivate={() => {}}
            onFileLinkClick={onFileLinkClick}
          />
        </div>
      ))}
    </div>
  );
}
