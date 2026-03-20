import { create } from 'zustand';
import { notify } from './utils.js';
import { applyTheme, DEFAULT_THEME } from './themes.js';

// Debounce timers kept outside store state (no re-renders on timer changes)
const _busyTimers = new Map();

const useStore = create((set, get) => ({
  // ── State ──────────────────────────────────────────────────────────────────
  sessions: [],
  currentSessionId: null,
  sessionPreviews: {},
  sessionBusy: {},
  sessionLastEvent: {},
  sessionOrder: [],
  sessionMap: {},
  wsStatus: 'connecting',
  sheetOpen: false,
  confirm: null,
  theme: localStorage.getItem('vipershell-theme') ?? DEFAULT_THEME,
  // ── Actions ────────────────────────────────────────────────────────────────

  setTheme(name) {
    localStorage.setItem('vipershell-theme', name);
    applyTheme(name);
    set({ theme: name });
  },

  setWsStatus(status) {
    set({ wsStatus: status });
  },

  setSheetOpen(open) {
    set({ sheetOpen: open });
  },

  /**
   * Update the sessions list from a server push.
   * Rebuilds sessionMap, sessionOrder (grouped by path).
   * Clears currentSessionId if the current session is no longer present.
   */
  renderSessions(sessions) {
    const { currentSessionId } = get();

    const sessionMap = Object.fromEntries(sessions.map(s => [s.id, s]));

    // Group by path to build ordered list
    const byPath = {};
    for (const s of sessions) {
      const key = s.path ?? '';
      if (!byPath[key]) byPath[key] = [];
      byPath[key].push(s);
    }
    const sessionOrder = Object.values(byPath).flat().map(s => s.id);

    // Clear current session id if it no longer exists
    const nextCurrentId =
      currentSessionId && sessionMap[currentSessionId] ? currentSessionId : null;

    // Update last-activity timestamps from server-provided values.
    // Only advance the timestamp — never go backwards (avoids flicker on re-broadcast).
    const nextLastEvent = { ...get().sessionLastEvent };
    for (const s of sessions) {
      if (s.last_activity) {
        const ms = Math.round(s.last_activity * 1000);
        if (!nextLastEvent[s.id] || ms > nextLastEvent[s.id]) {
          nextLastEvent[s.id] = ms;
        }
      }
    }

    set({
      sessions,
      sessionMap,
      sessionOrder,
      currentSessionId: nextCurrentId,
      sessionLastEvent: nextLastEvent,
    });
  },

  setCurrentSessionId(id) {
    if (id) localStorage.setItem('vipershell-last-session', id);
    set({ currentSessionId: id });
  },

  /**
   * Update preview text and busy state for a session.
   * Fires a notification if the session transitions from busy to idle
   * and is not the currently active session.
   */
  updatePreview(sessionId, preview, busy) {
    set(s => ({ sessionPreviews: { ...s.sessionPreviews, [sessionId]: preview } }));

    if (busy === true) {
      // Debounce visual busy indicator. Must exceed backend _IDLE_AFTER_SECS (2.0 s)
      // so spurious resize-induced screen changes are cancelled before showing.
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
      if (wasBusy) {
        const name = sessionMap[sessionId]?.name ?? 'terminal';
        notify('vipershell 🐍', `${name} finished`);
      }
      set(s => ({ sessionBusy: { ...s.sessionBusy, [sessionId]: false } }));
    }
  },

  /**
   * Show a confirmation dialog and return a Promise<boolean>.
   * Resolves with true if confirmed, false if cancelled.
   */
  showConfirm(message) {
    return new Promise(resolve => {
      set({ confirm: { message, resolve } });
    });
  },

  /**
   * Dismiss the confirmation dialog with a result.
   * @param {boolean} result
   */
  dismissConfirm(result) {
    const { confirm } = get();
    if (confirm) {
      confirm.resolve(result);
      set({ confirm: null });
    }
  },

  /**
   * Navigate to the previous or next session in order.
   * @param {'up'|'down'} direction
   * @returns {string|null} next session id, or null if navigation is not possible
   */
  navigateSession(direction) {
    const { sessionOrder, currentSessionId } = get();
    if (sessionOrder.length < 2) return null;
    const idx = sessionOrder.indexOf(currentSessionId);
    if (idx === -1) return null;
    const next = direction === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= sessionOrder.length) return null;
    return sessionOrder[next];
  },


}));

export default useStore;
