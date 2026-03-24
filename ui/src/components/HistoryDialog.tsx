import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

const TERMINAL_THEME = {
  background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', cursorAccent: '#0d1117',
  selectionBackground: 'rgba(88,166,255,0.3)',
  black: '#484f58', brightBlack: '#6e7681', red: '#ff7b72', brightRed: '#ffa198',
  green: '#3fb950', brightGreen: '#56d364', yellow: '#d29922', brightYellow: '#e3b341',
  blue: '#58a6ff', brightBlue: '#79c0ff', magenta: '#bc8cff', brightMagenta: '#d2a8ff',
  cyan: '#39c5cf', brightCyan: '#56d4dd', white: '#b1bac4', brightWhite: '#f0f6fc',
};

interface HistoryDialogProps {
  sessionId: string;
  onClose: () => void;
}

export default function HistoryDialog({ sessionId, onClose }: HistoryDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 50000,
      theme: TERMINAL_THEME,
      disableStdin: true,
      cursorBlink: false,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    fetch(`/api/sessions/${sessionId}/history`)
      .then(r => r.text())
      .then(text => {
        term.write(text);
        term.scrollToBottom();
      })
      .catch(e => {
        term.write(`\r\nFailed to load history: ${e.message}\r\n`);
      });

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[92vw] max-w-[1100px] flex flex-col gap-0 p-0" style={{ height: '85vh' }}>
        <DialogHeader className="px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
            History &mdash; {sessionId}
          </DialogTitle>
        </DialogHeader>
        <div ref={containerRef} className="flex-1 min-h-0 p-2" style={{ background: '#0d1117' }} />
      </DialogContent>
    </Dialog>
  );
}
