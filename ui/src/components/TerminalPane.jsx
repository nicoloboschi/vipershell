import { useCallback, useEffect, useRef, useState } from 'react';
import { SquareTerminal, Trash2 } from 'lucide-react';
import useStore from '../store.js';
import { notify } from '../utils.js';
import { Button } from './ui/button.jsx';
import StatChips from './StatChips.jsx';

/**
 * @param {{
 *   termRef: React.MutableRefObject<import('xterm').Terminal|null>,
 *   fitAddonRef: React.MutableRefObject<import('xterm-addon-fit').FitAddon|null>,
 *   sendRef: React.MutableRefObject<(msg: object) => void>,
 * }} props
 */
export default function TerminalPane({ termRef, fitAddonRef, sendRef }) {
  const currentSessionId = useStore(s => s.currentSessionId);
  const sessionMap       = useStore(s => s.sessionMap);
  const showConfirm      = useStore(s => s.showConfirm);
  const termContainerRef = useRef(null);

  const handleCloseSession = useCallback(async () => {
    const sid  = useStore.getState().currentSessionId;
    const name = useStore.getState().sessionMap[sid]?.name ?? 'session';
    const confirmed = await showConfirm(`Close session "${name}"?`);
    if (confirmed) sendRef.current({ type: 'close_session', session_id: sid });
  }, [showConfirm, sendRef]);

  // Mount terminal into DOM once
  useEffect(() => {
    const el = termContainerRef.current;
    if (!el || !termRef.current) return;
    termRef.current.open(el);
    fitAddonRef.current?.fit();
    return () => { el.replaceChildren(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire up onData and onBell
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    const dataDispose = term.onData((data) => {
      const sid = useStore.getState().currentSessionId;
      if (sid) sendRef.current({ type: 'input', data });
    });
    const bellDispose = term.onBell(() => {
      const state = useStore.getState();
      const session = state.sessionMap[state.currentSessionId];
      notify('vipershell 🐍', `Bell in ${session?.name ?? 'terminal'}`);
    });
    return () => { dataDispose.dispose(); bellDispose.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile: keep keyboard open by re-focusing xterm's internal textarea on blur
  useEffect(() => {
    const el = termContainerRef.current;
    if (!el) return;

    // Wait for xterm to create its internal textarea
    const observer = new MutationObserver(() => {
      const textarea = el.querySelector('textarea');
      if (!textarea) return;
      observer.disconnect();

      const refocus = () => {
        setTimeout(() => {
          const active = document.activeElement;
          // Don't steal focus if a real UI element (button, input, etc.) is active
          if (active && active !== document.body && active !== textarea &&
              (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'BUTTON' || active.tagName === 'A')) return;
          textarea.focus({ preventScroll: true });
        }, 150);
      };

      textarea.addEventListener('blur', refocus);
      // Cleanup stored so the outer cleanup can reach it
      el._mobileKbCleanup = () => textarea.removeEventListener('blur', refocus);
    });

    observer.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      el._mobileKbCleanup?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle window resize — debounced so the terminal doesn't reflow on every pixel during a drag
  useEffect(() => {
    let timer = null;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fitAddonRef.current?.fit();
        const term = termRef.current;
        const sid  = useStore.getState().currentSessionId;
        if (term && sid) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
      }, 80);
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const session = sessionMap[currentSessionId];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {currentSessionId && (
        <div
          className="flex items-center gap-1 px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="status-text hidden md:inline" style={{ marginRight: 8 }}>{session?.name ?? ''}</span>

          <StatChips />

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="icon"
            title="Close session"
            onClick={handleCloseSession}
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      )}

      <main
        className="flex-1 relative overflow-hidden min-h-0"
        style={{ background: 'var(--background)' }}
      >
        {!currentSessionId && (
          <div className="placeholder">
            <div className="placeholder-inner">
              <div className="placeholder-icon">
                <SquareTerminal size={40} strokeWidth={1.5} />
              </div>
              <div>Select a session to connect</div>
            </div>
          </div>
        )}
        <div id="terminal" ref={termContainerRef} />
        <TerminalScrollbar termContainerRef={termContainerRef} />
      </main>
    </div>
  );
}

function TerminalScrollbar({ termContainerRef }) {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const rafRef   = useRef(null);
  const dragging = useRef(false);
  const [hasScrollback, setHasScrollback] = useState(false);

  const getViewport = () => termContainerRef.current?.querySelector('.xterm-viewport');

  function syncThumb() {
    const viewport = getViewport();
    if (!viewport || !trackRef.current || !thumbRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const ratio = clientHeight / scrollHeight;
    setHasScrollback(ratio < 0.99);
    const trackH = trackRef.current.clientHeight;
    const thumbH = Math.max(44, trackH * ratio);
    const maxTop = trackH - thumbH;
    const top = ratio >= 1 ? 0 : maxTop - (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    thumbRef.current.style.height = `${thumbH}px`;
    thumbRef.current.style.transform = `translateY(${top}px)`;
  }

  // Keep thumb in sync with scroll & content changes
  useEffect(() => {
    let viewport = null;

    function onScroll() {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; syncThumb(); });
    }

    function attach() {
      viewport = getViewport();
      if (!viewport || viewport._scrollbarAttached) return;
      viewport._scrollbarAttached = true;
      viewport.addEventListener('scroll', onScroll, { passive: true });
      // Also re-sync when xterm writes new content (scrollHeight changes)
      const ro = new ResizeObserver(syncThumb);
      ro.observe(viewport);
      viewport._scrollbarRO = ro;
      syncThumb();
    }

    const mo = new MutationObserver(attach);
    mo.observe(termContainerRef.current, { childList: true, subtree: true });
    attach();

    return () => {
      mo.disconnect();
      if (viewport) {
        viewport.removeEventListener('scroll', onScroll);
        viewport._scrollbarRO?.disconnect();
      }
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag the thumb OR tap the track to jump
  const onTrackPointerDown = useCallback((e) => {
    e.preventDefault();
    const viewport = getViewport();
    if (!viewport || !trackRef.current || !thumbRef.current) return;

    dragging.current = true;
    const trackRect = trackRef.current.getBoundingClientRect();
    const thumbH = thumbRef.current.clientHeight;
    const trackH = trackRef.current.clientHeight;
    const maxTravel = trackH - thumbH;
    const { scrollHeight, clientHeight } = viewport;
    const maxScroll = scrollHeight - clientHeight;

    // Jump scroll to clicked position immediately
    const jumpTo = (clientY) => {
      const relY = clientY - trackRect.top - thumbH / 2;
      viewport.scrollTop = maxScroll - (Math.max(0, Math.min(relY, maxTravel)) / maxTravel) * maxScroll;
    };
    jumpTo(e.clientY);

    const onMove = (e) => { if (dragging.current) jumpTo(e.clientY); };
    const onUp   = () => {
      dragging.current = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasScrollback) return null;

  return (
    // Wide invisible track — easy to touch — with a narrow visible thumb inside
    <div
      ref={trackRef}
      className="md:hidden"
      onPointerDown={onTrackPointerDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 8,
        bottom: 8,
        width: 28,          // wide touch target
        zIndex: 10,
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      {/* Visible thumb pill — centered in the wide track */}
      <div
        ref={thumbRef}
        style={{
          position: 'absolute',
          right: 3,
          width: 5,
          borderRadius: 4,
          background: 'rgba(255,255,255,0.4)',
          minHeight: 44,
          pointerEvents: 'none', // track handles all events
        }}
      />
    </div>
  );
}
