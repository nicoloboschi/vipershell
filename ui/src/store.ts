import { create } from 'zustand';
import { notify } from './utils';
import { applyTheme, DEFAULT_THEME } from './themes';

export interface Session {
  id: string;
  name: string;
  path?: string;
  username?: string;
  last_activity?: number;
  isClaudeCode?: boolean;
  cpuPercent?: number;
  memMb?: number;
}

export interface ConfirmState {
  message: string;
  resolve: (result: boolean) => void;
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export interface StoreState {
  sessions: Session[];
  currentSessionId: string | null;
  sessionPreviews: Record<string, string>;
  sessionBusy: Record<string, boolean>;
  /** Sessions with unseen output (cleared when you switch to them) */
  sessionHasUnseen: Record<string, boolean>;
  sessionLastEvent: Record<string, number>;
  sessionOrder: string[];
  sessionMap: Record<string, Session>;
  sessionUrls: Record<string, string[]>;
  sessionLastCommand: Record<string, string>;
  sessionCurrentInput: Record<string, string>;
  openPaneMap: Record<string, number[]>;
  /** Session IDs that are terminal splits (hidden from session list) */
  splitSessionIds: Set<string>;
  wsStatus: WsStatus;
  sheetOpen: boolean;
  confirm: ConfirmState | null;
  theme: string;

  setTheme: (name: string) => void;
  setWsStatus: (status: WsStatus) => void;
  setSheetOpen: (open: boolean) => void;
  renderSessions: (sessions: Session[]) => void;
  setCurrentSessionId: (id: string | null) => void;
  setOpenPaneMap: (panes: (string | null)[]) => void;
  updatePreview: (sessionId: string, preview: string, busy?: boolean) => void;
  showConfirm: (message: string) => Promise<boolean>;
  dismissConfirm: (result: boolean) => void;
  addSessionUrl: (sessionId: string, url: string) => void;
  clearSessionUrls: (sessionId: string) => void;
  setLastCommand: (sessionId: string, command: string) => void;
  setCurrentInput: (sessionId: string, input: string) => void;
  markUnseen: (sessionId: string) => void;
  clearUnseen: (sessionId: string) => void;
  addSplitSession: (sessionId: string) => void;
  removeSplitSession: (sessionId: string) => void;
  navigateSession: (direction: 'up' | 'down') => string | null;
}

// Debounce timers kept outside store state (no re-renders on timer changes)
const _busyTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Active terminal send/refresh — updated by TerminalCell when it becomes active
export const activeTerminalSend    = { current: (_msg: Record<string, unknown>) => {} };
export const activeTerminalRefresh = { current: () => {} };

// Pre-load split session IDs from localStorage so they're hidden before first render
function loadSplitSessionIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const map = JSON.parse(localStorage.getItem('vipershell:term-grid') || '{}');
    for (const state of Object.values(map) as { cells?: string[] }[]) {
      if (state?.cells) {
        for (let i = 1; i < state.cells.length; i++) {
          if (state.cells[i]) ids.add(state.cells[i]!);
        }
      }
    }
  } catch { /* ignore */ }
  return ids;
}

const useStore = create<StoreState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  sessionPreviews: {},
  sessionBusy: {},
  sessionHasUnseen: {},
  sessionLastEvent: {},
  sessionOrder: [],
  sessionMap: {},
  sessionUrls: {},
  sessionLastCommand: {},
  sessionCurrentInput: {},
  openPaneMap: {},
  splitSessionIds: loadSplitSessionIds(),
  wsStatus: 'connecting',
  sheetOpen: false,
  confirm: null,
  theme: localStorage.getItem('vipershell-theme') ?? DEFAULT_THEME,

  setTheme(name: string) {
    localStorage.setItem('vipershell-theme', name);
    applyTheme(name);
    set({ theme: name });
  },

  setWsStatus(status: WsStatus) {
    set({ wsStatus: status });
  },

  setSheetOpen(open: boolean) {
    set({ sheetOpen: open });
  },

  renderSessions(sessions: Session[]) {
    const { currentSessionId } = get();

    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

    const sorted = [...sessions].sort((a, b) =>
      (parseInt(a.id.replace('$', ''), 10) || 0) - (parseInt(b.id.replace('$', ''), 10) || 0)
    );

    const byPath: Record<string, Session[]> = {};
    for (const s of sorted) {
      const key = s.path ?? '';
      if (!byPath[key]) byPath[key] = [];
      byPath[key].push(s);
    }
    const sessionOrder = Object.values(byPath).flat().map(s => s.id);

    const VIRTUAL_IDS = new Set(['__notes__']);
    const nextCurrentId =
      currentSessionId && (sessionMap[currentSessionId] || VIRTUAL_IDS.has(currentSessionId))
        ? currentSessionId
        : null;

    const nextLastEvent = { ...get().sessionLastEvent };
    for (const s of sorted) {
      if (s.last_activity) {
        const ms = Math.round(s.last_activity * 1000);
        if (!nextLastEvent[s.id] || ms > nextLastEvent[s.id]!) {
          nextLastEvent[s.id] = ms;
        }
      }
    }

    set({
      sessions: sorted,
      sessionMap,
      sessionOrder,
      currentSessionId: nextCurrentId,
      sessionLastEvent: nextLastEvent,
    });
  },

  setCurrentSessionId(id: string | null) {
    if (id) {
      localStorage.setItem('vipershell-last-session', id);
      // Clear unseen indicator when switching to this session
      const { sessionHasUnseen } = get();
      if (sessionHasUnseen[id]) {
        const next = { ...sessionHasUnseen };
        delete next[id];
        set({ sessionHasUnseen: next });
      }
    }
    set({ currentSessionId: id });
  },

  setOpenPaneMap(panes: (string | null)[]) {
    const map: Record<string, number[]> = {};
    panes.forEach((sid, idx) => {
      if (!sid) return;
      if (!map[sid]) map[sid] = [];
      map[sid].push(idx);
    });
    set({ openPaneMap: map });
  },

  updatePreview(sessionId: string, preview: string, busy?: boolean) {
    const { sessionPreviews, currentSessionId } = get();
    const prevPreview = sessionPreviews[sessionId];
    set(s => ({ sessionPreviews: { ...s.sessionPreviews, [sessionId]: preview } }));

    // Mark unseen if preview changed for a non-active session (skip first load when no prev exists)
    if (prevPreview !== undefined && preview !== prevPreview && sessionId !== currentSessionId) {
      set(s => ({ sessionHasUnseen: { ...s.sessionHasUnseen, [sessionId]: true } }));
    }

    if (busy === true) {
      if (_busyTimers.has(sessionId)) return;
      _busyTimers.set(sessionId, setTimeout(() => {
        _busyTimers.delete(sessionId);
        set(s => ({ sessionBusy: { ...s.sessionBusy, [sessionId]: true } }));
      }, 2200));
    } else if (busy === false) {
      const pending = _busyTimers.get(sessionId);
      if (pending) {
        clearTimeout(pending);
        _busyTimers.delete(sessionId);
        return;
      }
      const { sessionBusy, sessionMap } = get();
      const wasBusy = sessionBusy[sessionId] ?? false;
      if (wasBusy && sessionId !== currentSessionId) {
        const name = sessionMap[sessionId]?.name ?? 'terminal';
        notify('vipershell \u{1F40D}', `${name} finished`);
      }
      set(s => ({ sessionBusy: { ...s.sessionBusy, [sessionId]: false } }));
    }
  },

  showConfirm(message: string) {
    return new Promise<boolean>(resolve => {
      set({ confirm: { message, resolve } });
    });
  },

  dismissConfirm(result: boolean) {
    const { confirm } = get();
    if (confirm) {
      confirm.resolve(result);
      set({ confirm: null });
    }
  },

  addSessionUrl(sessionId: string, url: string) {
    const prev = get().sessionUrls[sessionId] ?? [];
    if (prev.length >= 50) return;
    const lower = url.toLowerCase();
    if (prev.some(u => u.toLowerCase() === lower)) return;
    set({ sessionUrls: { ...get().sessionUrls, [sessionId]: [...prev, url] } });
  },

  clearSessionUrls(sessionId: string) {
    const urls = { ...get().sessionUrls };
    delete urls[sessionId];
    set({ sessionUrls: urls });
  },

  setLastCommand(sessionId: string, command: string) {
    set(s => ({ sessionLastCommand: { ...s.sessionLastCommand, [sessionId]: command } }));
  },

  setCurrentInput(sessionId: string, input: string) {
    set(s => ({ sessionCurrentInput: { ...s.sessionCurrentInput, [sessionId]: input } }));
  },

  markUnseen(sessionId: string) {
    const { currentSessionId } = get();
    if (sessionId === currentSessionId) return; // user is watching this session
    set(s => ({ sessionHasUnseen: { ...s.sessionHasUnseen, [sessionId]: true } }));
  },

  clearUnseen(sessionId: string) {
    set(s => {
      const next = { ...s.sessionHasUnseen };
      delete next[sessionId];
      return { sessionHasUnseen: next };
    });
  },

  addSplitSession(sessionId: string) {
    set(s => {
      const next = new Set(s.splitSessionIds);
      next.add(sessionId);
      return { splitSessionIds: next };
    });
  },

  removeSplitSession(sessionId: string) {
    set(s => {
      const next = new Set(s.splitSessionIds);
      next.delete(sessionId);
      return { splitSessionIds: next };
    });
  },

  navigateSession(direction: 'up' | 'down') {
    const { currentSessionId } = get();
    const items = Array.from(document.querySelectorAll('[data-session-id]'));
    if (items.length < 2) return null;
    const idx = items.findIndex(el => (el as HTMLElement).dataset.sessionId === currentSessionId);
    if (idx === -1) return null;
    const next = (direction === 'up' ? idx - 1 + items.length : idx + 1) % items.length;
    return (items[next] as HTMLElement).dataset.sessionId ?? null;
  },
}));

export default useStore;
