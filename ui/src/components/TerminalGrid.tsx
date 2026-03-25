import { useState, useCallback, useEffect, useRef } from 'react';
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
    const saved = map[sessionId];
    if (saved && saved.cells?.length > 0 && saved.cells[0] === sessionId) return saved;
    return null;
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

function gridStyle(layout: Layout): React.CSSProperties {
  switch (layout) {
    case 'single':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    case 'horizontal':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    case 'vertical':
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr 1fr' };
    case 'quad':
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  }
}

export default function TerminalGrid({ sessionId, onCreateSplit, onFileLinkClick, onLayoutReady }: TerminalGridProps) {
  // Initialize from localStorage synchronously to avoid overwrite race
  const [layout, setLayout] = useState<Layout>(() => {
    return loadGridState(sessionId)?.layout ?? 'single';
  });
  const [cells, setCells] = useState<(string | null)[]>(() => {
    return loadGridState(sessionId)?.cells ?? [sessionId];
  });
  const [activeCell, setActiveCell] = useState(0);
  const creatingRef = useRef(false);
  const initializedRef = useRef(false);

  // Register split sessions on mount and when session changes
  useEffect(() => {
    const saved = loadGridState(sessionId);
    if (saved) {
      setLayout(saved.layout);
      setCells(saved.cells);
      // Register all split sessions so they're hidden from sidebar
      for (let i = 1; i < saved.cells.length; i++) {
        if (saved.cells[i]) useStore.getState().addSplitSession(saved.cells[i]!);
      }
    } else {
      setLayout('single');
      setCells([sessionId]);
    }
    setActiveCell(0);
    initializedRef.current = true;

    // No cleanup — splits stay registered (hidden from sidebar) even when
    // switching to another session. They're loaded from localStorage on init.
  }, [sessionId]);

  // Persist grid state — but only after initial restore
  useEffect(() => {
    if (!initializedRef.current) return;
    if (cells.every(c => c !== null)) {
      saveGridState(sessionId, layout, cells as string[]);
    }
  }, [sessionId, layout, cells]);

  // Create any missing sessions in parallel
  const ensureCells = useCallback((needed: number) => {
    if (creatingRef.current) return;
    setCells(currentCells => {
      const have = currentCells.length;
      if (have >= needed) return currentCells;

      const toCreate = needed - have;
      const next = [...currentCells, ...Array(toCreate).fill(null) as null[]];

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

  return (
    <div
      style={{
        display: 'grid',
        flex: 1,
        minHeight: 0,
        gap: 1,
        background: 'var(--border)',
        transition: 'grid-template-columns 0.2s ease, grid-template-rows 0.2s ease',
        ...gridStyle(layout),
      }}
    >
      {cells.map((sid, index) => {
        const visible = index < visibleCount;
        return (
          <div
            key={sid ?? `loading-${index}`}
            style={{
              display: visible ? 'flex' : 'none',
              minHeight: 0,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {sid === null ? (
              <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#0d1117', color: 'var(--muted-foreground)',
              }}>
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : (
              <TerminalCell
                sessionId={sid}
                isActive={activeCell === index}
                onActivate={() => setActiveCell(index)}
                onFileLinkClick={onFileLinkClick}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
