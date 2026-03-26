import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { ArrowDown, Upload } from 'lucide-react';
import useStore, { activeTerminalSend, activeTerminalRefresh } from '../store';
import { wsUrl } from '../serverUrl';

const filterAltScreen = (data: string): string =>
  data
    .replace(/\x1b\[\?(1049|47|1047)[hl]/g, '')   // strip alt-screen enter/exit
    .replace(/\x1b\[3J/g, '')                       // strip clear-scrollback (CSI 3 J)
    .replace(/\x1bc/g, '');                          // strip hard reset (RIS)

// Match URLs: scheme + domain + optional path/query/fragment (stop at whitespace, quotes, parens, angles, control chars)
const URL_RE = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9](?::\d+)?(?:\/[^\s"'<>()\x1b\x07\u0007\]{}|\\^`]*)?/g;
const stripAnsi = (s: string) => s.replace(/\x1b(?:\[[0-9;]*[a-zA-Z]|\].*?(?:\x07|\x1b\\))/g, '');

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
  onFileLinkClick?: (path: string) => void;
}

export default function TerminalCell({ sessionId, isActive, onActivate, onFileLinkClick }: TerminalCellProps) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sendRef = useRef<(msg: Record<string, unknown>) => void>(() => {});
  const pendingResetRef = useRef(false);
  const mountedRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  // Output batching — accumulate chunks and flush once per animation frame
  const outputBufRef = useRef('');
  const flushRafRef = useRef(0);

  // Create terminal once
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: isMobile ? 11 : 14,
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

    // Scroll position tracking — show "jump to bottom" when scrolled up
    const SCROLL_THRESHOLD = 5; // lines from bottom to trigger
    const scrollDispose = term.onScroll(() => {
      const buf = term.buffer.active;
      const linesFromBottom = buf.baseY - buf.viewportY;
      setShowScrollBottom(linesFromBottom > SCROLL_THRESHOLD);
    });

    // Bell — notify user when a background session rings (e.g. Claude Code finished)
    const bellDispose = term.onBell(() => {
      const state = useStore.getState();
      const session = state.sessionMap[sessionId];
      const name = session?.name ?? 'terminal';
      state.markUnseen(sessionId);
      import('../utils').then(({ notify }) => notify('vipershell \u{1F40D}', `${name} needs attention`));
    });

    return () => {
      scrollDispose.dispose();
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
      ws = new WebSocket(wsUrl());
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
          const filtered = filterAltScreen(msg.data);
          // Accumulate output and flush once per animation frame for smoother rendering
          outputBufRef.current += filtered;
          if (!flushRafRef.current) {
            flushRafRef.current = requestAnimationFrame(() => {
              flushRafRef.current = 0;
              const batch = outputBufRef.current;
              outputBufRef.current = '';
              const t = termRef.current;
              if (!t || !batch) return;
              t.write(batch);
              // Extract URLs from the batched output
              const plain = stripAnsi(batch);
              const urls = plain.match(URL_RE);
              if (urls) {
                const store = useStore.getState();
                for (const url of urls) {
                  const clean = url.replace(/[.,;:!?)'"}\]]+$/, '');
                  store.addSessionUrl(sessionId, clean);
                }
              }
            });
          }
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
      if (flushRafRef.current) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = 0; }
      outputBufRef.current = '';
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
      activeTerminalRefresh.current = () => sendRef.current({ type: 'connect', session_id: sessionId });
    }
  }, [isActive]);

  // Refit + refocus when terminal tab becomes visible again
  useEffect(() => {
    const handler = () => {
      if (!isActive) return;
      fitAddonRef.current?.fit();
      termRef.current?.focus();
      const term = termRef.current;
      if (term) sendRef.current({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    window.addEventListener('vipershell:terminal-tab-active', handler);
    return () => window.removeEventListener('vipershell:terminal-tab-active', handler);
  }, [isActive]);

  // Touch scroll with momentum (iOS-style inertial scrolling)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startX = 0, startY = 0, lastTouchY = 0, lastTouchTime = 0;
    let accPx = 0, totalDy = 0;
    let isTouchScrolling = false, directionLocked = false;
    let velocity = 0;
    let momentumRaf = 0;

    const stopMomentum = () => {
      if (momentumRaf) { cancelAnimationFrame(momentumRaf); momentumRaf = 0; }
      velocity = 0;
    };

    const onTouchStart = (e: TouchEvent): void => {
      stopMomentum();
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      lastTouchY = startY;
      lastTouchTime = Date.now();
      accPx = 0; totalDy = 0;
      isTouchScrolling = false; directionLocked = false; velocity = 0;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const term = termRef.current;
      if (!term) return;
      const now = Date.now();
      const x = e.touches[0]!.clientX;
      const y = e.touches[0]!.clientY;
      const dy = lastTouchY - y;
      const dt = Math.max(1, now - lastTouchTime);

      // Lock direction after a few pixels of movement
      if (!directionLocked) {
        const adx = Math.abs(x - startX);
        const ady = Math.abs(y - startY);
        if (adx + ady > 5) {
          directionLocked = true;
          isTouchScrolling = ady > adx; // vertical = scroll, horizontal = let xterm handle
        }
      }

      if (!isTouchScrolling) return;

      // Always prevent default once we've decided to scroll —
      // this stops xterm from doing text selection or its own scroll
      e.preventDefault();
      e.stopPropagation();

      // Track velocity (px/ms) with smoothing
      velocity = 0.6 * velocity + 0.4 * (dy / dt);

      lastTouchY = y;
      lastTouchTime = now;
      totalDy += dy;
      accPx += dy;
      const lineH = (term.options?.fontSize ?? 14) * (term.options?.lineHeight ?? 1.2);
      const lines = Math.trunc(accPx / lineH);
      if (lines !== 0) {
        accPx -= lines * lineH;
        term.scrollLines(lines);
      }
    };
    const onTouchEnd = (): void => {
      if (!isTouchScrolling) { velocity = 0; return; }
      isTouchScrolling = false;

      // Only animate momentum if velocity is significant
      if (Math.abs(velocity) < 0.3) { velocity = 0; return; }

      const term = termRef.current;
      if (!term) return;
      const lineH = (term.options?.fontSize ?? 14) * (term.options?.lineHeight ?? 1.2);
      let v = velocity * 16; // convert px/ms to px/frame (~16ms)
      let residual = 0;
      const FRICTION = 0.95;
      const MIN_V = 0.5;

      const tick = () => {
        if (Math.abs(v) < MIN_V) { velocity = 0; return; }
        residual += v;
        const lines = Math.trunc(residual / lineH);
        if (lines !== 0) {
          residual -= lines * lineH;
          term.scrollLines(lines);
        }
        v *= FRICTION;
        momentumRaf = requestAnimationFrame(tick);
      };
      momentumRaf = requestAnimationFrame(tick);
    };
    const onWheel = (e: WheelEvent): void => {
      const term = termRef.current;
      if (!term || term.buffer?.active?.type === 'alternate') return;
      e.preventDefault(); e.stopPropagation();
      const lineH = (term.options?.fontSize ?? 14) * (term.options?.lineHeight ?? 1.2);
      let lines: number;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        lines = Math.round(e.deltaY);
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        lines = Math.round(e.deltaY * (term.rows ?? 20));
      } else {
        lines = Math.round(e.deltaY / lineH);
      }
      if (lines !== 0) term.scrollLines(lines);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });

    return () => {
      stopMomentum();
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
      el.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, []);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    dragCountRef.current = 0;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Get session CWD
    let cwd = '/tmp';
    try {
      const res = await fetch(`/api/fs/${encodeURIComponent(sessionId)}/browse`);
      const data = await res.json();
      if (data.cwd) cwd = data.cwd;
    } catch { /* fallback to /tmp */ }

    // Upload each file and type the path
    const paths: string[] = [];
    for (const file of files) {
      try {
        const res = await fetch(`/api/fs/upload?dir=${encodeURIComponent(cwd)}&name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
        });
        const { ok, path } = await res.json();
        if (ok && path) paths.push(path);
      } catch { /* skip failed uploads */ }
    }

    // Type the paths into the terminal (space-separated, shell-escaped)
    if (paths.length > 0) {
      const escaped = paths.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
      sendRef.current({ type: 'input', data: escaped });
    }
  }

  return (
    <div
      className="flex-1 min-h-0 min-w-0"
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        background: '#0d1117', overflow: 'hidden',
        outline: dragOver ? '2px solid var(--primary)' : isActive ? '1px solid var(--primary)' : '1px solid transparent',
        outlineOffset: -1,
      }}
      onClick={onActivate}
      onDragEnter={(e) => { e.preventDefault(); dragCountRef.current++; setDragOver(true); }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => { dragCountRef.current--; if (dragCountRef.current <= 0) { setDragOver(false); dragCountRef.current = 0; } }}
      onDrop={handleDrop}
    >
      <div
        ref={containerRef}
        className="terminal-pane"
      />
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(13,17,23,0.85)',
          pointerEvents: 'none',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            color: 'var(--primary)', fontSize: 13, fontWeight: 600,
          }}>
            <Upload size={28} />
            Drop to upload
          </div>
        </div>
      )}
      {showScrollBottom && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            termRef.current?.scrollToBottom();
            setShowScrollBottom(false);
          }}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 14px',
            borderRadius: 20,
            border: '1px solid var(--border)',
            background: 'rgba(22, 27, 34, 0.92)',
            backdropFilter: 'blur(8px)',
            color: 'var(--muted-foreground)',
            fontSize: 11,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            transition: 'opacity 0.15s, transform 0.15s',
            animation: 'fade-in 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--muted-foreground)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <ArrowDown size={12} />
          Bottom
        </button>
      )}
    </div>
  );
}
