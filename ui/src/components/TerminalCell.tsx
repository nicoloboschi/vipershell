import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { X } from 'lucide-react';
import useStore, { activeTerminalSend } from '../store';

const filterAltScreen = (data: string): string =>
  data.replace(/\x1b\[\?(1049|47|1047)[hl]/g, '');

const TERMINAL_THEME = {
  background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', cursorAccent: '#0d1117',
  selectionBackground: 'rgba(88,166,255,0.3)',
  black: '#484f58', brightBlack: '#6e7681', red: '#ff7b72', brightRed: '#ffa198',
  green: '#3fb950', brightGreen: '#56d364', yellow: '#d29922', brightYellow: '#e3b341',
  blue: '#58a6ff', brightBlue: '#79c0ff', magenta: '#bc8cff', brightMagenta: '#d2a8ff',
  cyan: '#39c5cf', brightCyan: '#56d4dd', white: '#b1bac4', brightWhite: '#f0f6fc',
};

interface TerminalCellProps {
  sessionId: string;
  isActive: boolean;
  onActivate: () => void;
  onClose?: (() => void) | null;
  onFileLinkClick?: (path: string) => void;
}

export default function TerminalCell({ sessionId, isActive, onActivate, onClose, onFileLinkClick }: TerminalCellProps) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sendRef = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const pendingResetRef = useRef(false);
  const mountedRef = useRef(true);

  // Create terminal once
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon((_: MouseEvent, url: string) => window.open(url, '_blank', 'noopener'));
    term.loadAddon(fit);
    term.loadAddon(links);
    termRef.current = term;
    fitAddonRef.current = fit;

    // Mount
    const el = containerRef.current;
    if (el) {
      term.open(el);
      fit.fit();
    }

    // Input handler
    const dataDispose = term.onData((data: string) => {
      if (/^\x1b\[[\?>][\d;]*c$/.test(data)) return;
      sendRef.current({ type: 'input', data });
    });

    // Bell
    const bellDispose = term.onBell(() => {
      const state = useStore.getState();
      const session = state.currentSessionId ? state.sessionMap[state.currentSessionId] : undefined;
      import('../utils').then(({ notify }) => notify('vipershell \u{1F40D}', `Bell in ${session?.name ?? 'terminal'}`));
    });

    return () => {
      dataDispose.dispose();
      bellDispose.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // File link provider
  useEffect(() => {
    const term = termRef.current;
    if (!term || !onFileLinkClick) return;
    const FILE_RE = /((?:~\/|\.\.?\/|\/(?![\s/]))[\w./\-@~+%:]+)/g;
    const provider = term.registerLinkProvider({
      provideLinks(y: number, callback: (links: any[]) => void): void {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) { callback([]); return; }
        const text = line.translateToString();
        const links: any[] = [];
        let match: RegExpExecArray | null;
        FILE_RE.lastIndex = 0;
        while ((match = FILE_RE.exec(text)) !== null) {
          const raw = match[1]!;
          if (raw.includes('://')) continue;
          links.push({
            range: { start: { x: match.index + 1, y }, end: { x: match.index + raw.length, y } },
            text: raw,
            decorations: { underline: true, pointerCursor: true },
            activate(event: MouseEvent, linkText: string) { if (event?.metaKey || event?.ctrlKey) onFileLinkClick(linkText); },
          });
        }
        callback(links);
      },
    });
    return () => provider.dispose();
  }, [onFileLinkClick]);

  // WebSocket connection
  useEffect(() => {
    mountedRef.current = true;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1000;

    function openWs(): void {
      if (!mountedRef.current) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;

      sendRef.current = (msg: Record<string, unknown>) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      };

      ws.onopen = () => {
        if (!mountedRef.current) return;
        delay = 1000;
        fitAddonRef.current?.fit();
        sendRef.current({ type: 'connect', session_id: sessionId });
      };

      ws.onmessage = (ev: MessageEvent) => {
        if (!mountedRef.current) return;
        let msg: any;
        try { msg = JSON.parse(ev.data); } catch { return; }

        if (msg.type === 'sessions') {
          useStore.getState().renderSessions(msg.sessions);
        } else if (msg.type === 'preview') {
          useStore.getState().updatePreview(msg.session_id, msg.preview, msg.busy);
        } else if (msg.type === 'last_command') {
          useStore.getState().setLastCommand(msg.session_id, msg.command);
        } else if (msg.type === 'connected') {
          pendingResetRef.current = true;
          const term = termRef.current;
          if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
        } else if (msg.type === 'output') {
          const term = termRef.current;
          if (!term) return;
          if (pendingResetRef.current) {
            pendingResetRef.current = false;
            term.reset();
          }
          term.write(filterAltScreen(msg.data));
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        retryTimer = setTimeout(() => {
          delay = Math.min(delay * 2, 30_000);
          openWs();
        }, delay);
      };
    }

    openWs();

    return () => {
      mountedRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }, [sessionId]);

  // Resize handling
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fitAddonRef.current?.fit();
        const term = termRef.current;
        if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
      }, 80);
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); if (timer) clearTimeout(timer); };
  }, []);

  // ResizeObserver on container for panel resize (debounced)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const doFit = () => {
      try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
      const term = termRef.current;
      if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(doFit, 50);
    });
    ro.observe(el);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  // Focus when active + register as the target for mobile key bar
  useEffect(() => {
    if (isActive) {
      termRef.current?.focus();
      activeTerminalSend.current = (msg) => sendRef.current(msg);
    }
  }, [isActive]);

  // Touch scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastTouchY = 0, accPx = 0, isTouchScrolling = false;
    const getVp = (): HTMLElement | null => el.querySelector('.xterm-viewport') as HTMLElement | null;

    const onTouchStart = (e: TouchEvent): void => {
      lastTouchY = e.touches[0]!.clientY;
      accPx = 0; isTouchScrolling = false;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const dy = lastTouchY - e.touches[0]!.clientY;
      lastTouchY = e.touches[0]!.clientY;
      accPx += dy;
      const px = Math.trunc(accPx); accPx -= px;
      if (px !== 0) {
        const vp = getVp();
        if (vp) { vp.scrollTop = Math.max(0, Math.min(vp.scrollTop + px, vp.scrollHeight - vp.clientHeight)); isTouchScrolling = true; }
      }
      if (isTouchScrolling) { e.preventDefault(); e.stopPropagation(); }
    };
    const onTouchEnd = (): void => { isTouchScrolling = false; };
    const onWheel = (e: WheelEvent): void => {
      if (termRef.current?.buffer?.active?.type === 'alternate') return;
      e.preventDefault(); e.stopPropagation();
      const vp = getVp();
      if (!vp) return;
      const deltaPx = e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? e.deltaY * ((termRef.current?.options?.fontSize ?? 14) * (termRef.current?.options?.lineHeight ?? 1.2))
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? e.deltaY * (termRef.current?.rows ?? 20) * ((termRef.current?.options?.fontSize ?? 14) * (termRef.current?.options?.lineHeight ?? 1.2))
          : e.deltaY;
      vp.scrollTop = Math.max(0, Math.min(vp.scrollTop + deltaPx, vp.scrollHeight - vp.clientHeight));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
      el.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);

  return (
    <div
      className="flex-1 min-h-0 min-w-0"
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        background: '#0d1117', overflow: 'hidden',
        outline: isActive ? '1px solid var(--primary)' : '1px solid transparent',
        outlineOffset: -1,
      }}
      onClick={onActivate}
    >
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close split"
          style={{
            position: 'absolute', top: 4, right: 4, zIndex: 10,
            background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)',
            borderRadius: 4, cursor: 'pointer', padding: 2,
            color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center',
            opacity: 0.5, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; }}
        >
          <X size={12} />
        </button>
      )}
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0, padding: 8, overflow: 'hidden' }}
      />
    </div>
  );
}
