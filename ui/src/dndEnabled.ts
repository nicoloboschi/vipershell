import { createContext, useContext } from 'react';

/** Global switch for drag-and-drop interactivity.
 *
 *  Defaults to `true` so desktop users get full dnd-kit behavior (workspace
 *  reorder, pane swap inside a workspace, cross-workspace pane merge,
 *  extract-to-new-workspace drops).
 *
 *  On mobile (<= 767px viewport), App.tsx provides `false` so every
 *  draggable/droppable/sortable hook is disabled and the sidebar becomes
 *  a plain tappable list of workspaces. We still CALL all the hooks (hook
 *  order must stay stable), but each one is passed `disabled: true`, and
 *  affordances like grip handles and gap drop zones are hidden.
 *
 *  Consumed by SessionList, SessionItem, PaneCard, PaneHeader, TerminalCell. */
export const DndEnabledContext = createContext<boolean>(true);

export const useDndEnabled = (): boolean => useContext(DndEnabledContext);
