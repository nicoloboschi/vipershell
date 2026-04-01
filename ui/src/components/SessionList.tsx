import { useState, useRef, useCallback } from 'react';
import { StickyNote } from 'lucide-react';
import useStore, { type Session } from '../store';
import SessionGroup from './SessionGroup';
import { ScrollArea } from './ui/scroll-area';
import { NOTES_SESSION_ID } from './PaneTerminal';

interface Workspace {
  key: string;
  name: string;
  sessions: Session[];
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || p;
}

const STORAGE_KEY = 'vipershell:workspace-order';

function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function saveOrder(order: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* quota */ }
}

function sortWorkspaces(workspaces: Workspace[], storedOrder: string[]): Workspace[] {
  if (storedOrder.length === 0) return workspaces;
  const orderMap = new Map(storedOrder.map((key, i) => [key, i]));
  return [...workspaces].sort((a, b) => {
    const ai = orderMap.get(a.key) ?? Infinity;
    const bi = orderMap.get(b.key) ?? Infinity;
    if (ai === bi) return 0; // both unknown — keep natural order
    return ai - bi;
  });
}

interface SessionListProps {
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
  id?: string;
}

export default function SessionList({ onConnect, send, id }: SessionListProps) {
  const allSessions = useStore(s => s.sessions);
  const splitIds = useStore(s => s.splitSessionIds);
  const sessions = allSessions.filter(s => !splitIds.has(s.id));
  const currentSessionId = useStore(s => s.currentSessionId);

  const [order, setOrder] = useState(loadOrder);
  const draggedRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  if (!sessions.length) {
    return (
      <ScrollArea id={id} className="session-list flex-1 py-2">
        <div className="empty-state">No sessions found</div>
      </ScrollArea>
    );
  }

  // Group sessions into workspaces
  const workspaceMap = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.gitRoot ?? s.path ?? '';
    if (!workspaceMap.has(key)) workspaceMap.set(key, []);
    workspaceMap.get(key)!.push(s);
  }

  const rawWorkspaces: Workspace[] = Array.from(workspaceMap.entries()).map(([key, ss]) => ({
    key,
    name: key ? basename(key) : 'Home',
    sessions: ss,
  }));

  const workspaces = sortWorkspaces(rawWorkspaces, order);

  // Drag handlers
  const handleDragStart = (key: string) => {
    draggedRef.current = key;
  };

  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedRef.current && draggedRef.current !== key) {
      setDragOverKey(key);
    }
  };

  const handleDragLeave = () => {
    setDragOverKey(null);
  };

  const handleDrop = (targetKey: string) => {
    const sourceKey = draggedRef.current;
    setDragOverKey(null);
    draggedRef.current = null;
    if (!sourceKey || sourceKey === targetKey) return;

    // Build new order from current visual order
    const currentKeys = workspaces.map(w => w.key);
    const fromIdx = currentKeys.indexOf(sourceKey);
    const toIdx = currentKeys.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;

    currentKeys.splice(fromIdx, 1);
    currentKeys.splice(toIdx, 0, sourceKey);

    setOrder(currentKeys);
    saveOrder(currentKeys);
  };

  const handleDragEnd = () => {
    draggedRef.current = null;
    setDragOverKey(null);
  };

  const isNotesActive = currentSessionId === NOTES_SESSION_ID;

  return (
    <ScrollArea id={id} className="session-list flex-1 py-2">
      <div
        onClick={() => onConnect(NOTES_SESSION_ID)}
        data-session-id={NOTES_SESSION_ID}
        className={`session-item${isNotesActive ? ' active' : ''}`}
      >
        <span className="session-icon" style={{ opacity: isNotesActive ? 0.7 : 0.4 }}>
          <StickyNote size={12} />
        </span>
        <span className="session-name-inline">Notes</span>
      </div>

      <div className="session-section-label" style={{ marginTop: 10 }}>Workspaces</div>

      {workspaces.map(({ key, name, sessions: ss }) => (
        <SessionGroup
          key={key}
          name={name}
          path={ss[0]?.path ?? null}
          sessions={ss}
          onConnect={onConnect}
          send={send}
          workspaceKey={key}
          isDragOver={dragOverKey === key}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        />
      ))}
    </ScrollArea>
  );
}
