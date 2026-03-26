import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

interface LogsModalProps {
  onClose: () => void;
}

export default function LogsModal({ onClose }: LogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource('/api/logs/stream');
    es.onmessage = (e) => {
      const entry: LogEntry = JSON.parse(e.data);
      setLogs(prev => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  }, [logs]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[900px] max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
            Server Logs
          </DialogTitle>
        </DialogHeader>
        <div className="p-4 flex-1 min-h-0">
          <div className="settings-logs-body">
            {logs.length === 0 && <span style={{ color: 'var(--muted-foreground)' }}>No logs yet\u2026</span>}
            {logs.map((l, i) => (
              <div key={i} className={`log-entry ${l.level}`}>
                {l.ts} {l.level.padEnd(8)} {l.msg}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
