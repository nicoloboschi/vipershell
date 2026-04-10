import { useState } from 'react';
import { StickyNote, SquarePlus } from 'lucide-react';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable, useDndMonitor } from '@dnd-kit/core';
import useStore, { type Workspace } from '../store';
import SessionItem, { loadFavourites, toggleFavourite } from './SessionItem';
import { ScrollArea } from './ui/scroll-area';
import { NOTES_SESSION_ID } from './PaneTerminal';
import { useDndEnabled } from '../dndEnabled';

interface SessionListProps {
  onConnect: (id: string) => void;
  send: (msg: Record<string, unknown>) => void;
  id?: string;
}

/** Drop zone that sits in the gap between workspace rows (and at the start
 *  and end of each section). Registered as a dnd-kit droppable so it
 *  receives pane drags. Dropping a pane here extracts it into a brand-new
 *  workspace at this position; App.tsx's onDragEnd handles the action.
 *
 *  Idle: invisible. Pane drag in flight: faint dashed line. Hovered while
 *  the active drag is over this gap: solid blue glow line + a "Drop to
 *  extract" hint. */
function GapDropZone({
  prevId, nextId, anyPaneDragActive,
}: {
  prevId: string | null;
  nextId: string | null;
  anyPaneDragActive: boolean;
}): React.ReactElement {
  const dropId = `gap:${prevId ?? 'start'}->${nextId ?? 'end'}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: { kind: 'gap', prevId, nextId },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        'gap-drop-zone',
        anyPaneDragActive ? 'gap-drop-zone-armed' : '',
        isOver ? 'gap-drop-zone-hover' : '',
      ].filter(Boolean).join(' ')}
      data-prev={prevId ?? ''}
      data-next={nextId ?? ''}
    >
      <div className="gap-drop-zone-line" />
      {anyPaneDragActive && (
        <div className="gap-drop-zone-label">
          <SquarePlus size={14} />
          <span>Drop to create a new workspace</span>
        </div>
      )}
    </div>
  );
}

export default function SessionList({ onConnect, send, id }: SessionListProps) {
  const workspaces = useStore(s => s.workspaces);
  const workspaceOrder = useStore(s => s.workspaceOrder);
  const currentSessionId = useStore(s => s.currentSessionId);
  const [favourites, setFavourites] = useState(loadFavourites);
  const dndEnabled = useDndEnabled();

  // Track whether a *pane* drag is currently in flight in the global
  // DndContext so the gap zones can light up only when relevant. We use
  // dnd-kit's useDndMonitor — it works because SessionList renders inside
  // App.tsx's DndContext.
  const [anyPaneDragActive, setAnyPaneDragActive] = useState(false);
  useDndMonitor({
    onDragStart(e) {
      const data = e.active.data.current as { kind?: string } | undefined;
      if (data?.kind === 'pane') setAnyPaneDragActive(true);
    },
    onDragEnd() { setAnyPaneDragActive(false); },
    onDragCancel() { setAnyPaneDragActive(false); },
  });

  // Resolve workspaces in the order the store reports, skipping any that
  // might have been deleted mid-render.
  const allWs: Workspace[] = workspaceOrder
    .map(id => workspaces[id])
    .filter((w): w is Workspace => !!w);

  if (allWs.length === 0) {
    return (
      <ScrollArea id={id} className="session-list flex-1 py-2">
        <div
          onClick={() => onConnect(NOTES_SESSION_ID)}
          data-session-id={NOTES_SESSION_ID}
          className={`session-item${currentSessionId === NOTES_SESSION_ID ? ' active' : ''}`}
        >
          <span className="session-icon" style={{ opacity: currentSessionId === NOTES_SESSION_ID ? 0.7 : 0.4 }}>
            <StickyNote size={12} />
          </span>
          <span className="session-name-inline">Notes</span>
        </div>
        <div className="empty-state">No workspaces yet</div>
      </ScrollArea>
    );
  }

  const favWs = allWs.filter(w => favourites.has(w.id));
  const otherWs = allWs.filter(w => !favourites.has(w.id));
  const isNotesActive = currentSessionId === NOTES_SESSION_ID;

  // Single sortable context spans BOTH sections. Items are addressed by
  // workspace.id; the visual section split is purely cosmetic.
  const sortableIds = allWs.map(w => w.id);

  /** Render a section of workspace rows. No more per-row gap drop zones —
   *  there's a single "create new workspace" zone at the bottom of the
   *  whole list (rendered outside this helper). */
  const renderSection = (section: Workspace[], isFav: boolean): React.ReactElement[] =>
    section.map(ws => (
      <SessionItem
        key={ws.id}
        workspace={ws}
        isActive={currentSessionId === ws.id}
        onConnect={onConnect}
        send={send}
        isFavourite={isFav}
        onToggleFavourite={() => setFavourites(toggleFavourite(ws.id))}
      />
    ));

  // The id of the very last workspace in the list — used as `prevId` for
  // the single trailing gap drop zone, so dropping a pane there extracts
  // it into a new workspace appended at the end of workspaceOrder.
  const lastWsId = allWs[allWs.length - 1]?.id ?? null;

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

      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {favWs.length > 0 && (
          <>
            <div className="session-section-label" style={{ marginTop: 10 }}>Favourites</div>
            {renderSection(favWs, true)}
          </>
        )}

        {otherWs.length > 0 && (
          <>
            <div className="session-section-label" style={{ marginTop: 10 }}>Workspaces</div>
            {renderSection(otherWs, false)}
          </>
        )}
      </SortableContext>

      {/* The single "create new workspace" drop target. Drops a pane here →
          extract to a new workspace appended at the end of workspaceOrder.
          Lights up only when a pane drag is in flight. Hidden on mobile
          (no drag there). */}
      {dndEnabled && (
        <GapDropZone
          prevId={lastWsId}
          nextId={null}
          anyPaneDragActive={anyPaneDragActive}
        />
      )}
    </ScrollArea>
  );
}
