import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { DialogHeader, DialogTitle } from './ui/dialog';
import ConfigDialog from './ConfigDialog';

const TERMINAL_THEME = {
  background: '#0c0c0c', foreground: '#d4d4d8', cursor: '#4ADE80', cursorAccent: '#0c0c0c',
  selectionBackground: 'rgba(74,222,128,0.25)',
  black: '#3B3B3B', brightBlack: '#525252', red: '#F87171', brightRed: '#FCA5A5',
  green: '#4ADE80', brightGreen: '#86EFAC', yellow: '#FACC15', brightYellow: '#FDE68A',
  blue: '#60A5FA', brightBlue: '#93C5FD', magenta: '#C084FC', brightMagenta: '#D8B4FE',
  cyan: '#22D3EE', brightCyan: '#67E8F9', white: '#D4D4D8', brightWhite: '#F4F4F5',
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
      fontFamily: '"JetBrains Mono", monospace',
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
    <ConfigDialog open onClose={onClose}>
        <DialogHeader className="px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
            History &mdash; {sessionId}
          </DialogTitle>
        </DialogHeader>
        <div ref={containerRef} className="flex-1 min-h-0 p-2" style={{ background: '#0c0c0c' }} />
    </ConfigDialog>
  );
}
