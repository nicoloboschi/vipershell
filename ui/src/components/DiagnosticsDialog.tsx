import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface PubsubChannel {
  channel: string;
  subscribers: number;
}

interface ServerMemory {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface Diagnostics {
  managedPtys: number;
  scrollbackStreams: number;
  memBuffers: number;
  inputBuffers: number;
  knownSessions: number;
  pubsubChannels: PubsubChannel[];
  serverMemory: ServerMemory;
  uptimeSeconds: number;
}

interface BrowserMemory {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
}

function fmt(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

const ROW: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '5px 0', borderBottom: '1px solid var(--border)',
  fontSize: 12,
};
const LABEL: React.CSSProperties = { color: 'var(--muted-foreground)' };
const VALUE: React.CSSProperties = { fontFamily: 'monospace', color: 'var(--foreground)' };
const WARN: React.CSSProperties = { ...VALUE, color: 'var(--destructive)' };
const SECTION: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--foreground)', opacity: 0.7,
  textTransform: 'uppercase' as const, letterSpacing: '0.04em',
  marginTop: 14, marginBottom: 4,
};

interface DiagnosticsDialogProps {
  onClose: () => void;
}

export default function DiagnosticsDialog({ onClose }: DiagnosticsDialogProps) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserMem, setBrowserMem] = useState<BrowserMemory | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDiag() {
      try {
        const res = await fetch('/api/diagnostics');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) { setDiag(data); setError(null); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    function sampleBrowser() {
      const perf = (performance as any).memory;
      if (perf) {
        setBrowserMem({
          jsHeapSizeLimit: perf.jsHeapSizeLimit,
          totalJSHeapSize: perf.totalJSHeapSize,
          usedJSHeapSize: perf.usedJSHeapSize,
        });
      }
    }

    fetchDiag();
    sampleBrowser();
    const id = setInterval(() => { fetchDiag(); sampleBrowser(); }, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const heapUsedGb = browserMem ? browserMem.usedJSHeapSize / (1024 ** 3) : 0;
  const heapHigh = heapUsedGb > 1;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[520px] max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
            Diagnostics
          </DialogTitle>
        </DialogHeader>

        <div style={{ padding: 16, overflowY: 'auto', fontSize: 12 }}>
          {error && (
            <div style={{ color: 'var(--destructive)', marginBottom: 8 }}>
              Failed to fetch: {error}
            </div>
          )}

          {/* Browser / Tab Memory */}
          <div style={SECTION}>Browser Tab</div>
          {browserMem ? (
            <>
              <div style={ROW}>
                <span style={LABEL}>JS Heap Used</span>
                <span style={heapHigh ? WARN : VALUE}>{fmt(browserMem.usedJSHeapSize)}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>JS Heap Total</span>
                <span style={VALUE}>{fmt(browserMem.totalJSHeapSize)}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>JS Heap Limit</span>
                <span style={VALUE}>{fmt(browserMem.jsHeapSizeLimit)}</span>
              </div>
              {heapHigh && (
                <div style={{ color: 'var(--destructive)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                  Heap is above 1 GB. Possible memory leak. Try closing and reopening the tab.
                  If this keeps happening, reduce open terminals or check for long-running sessions.
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
              performance.memory not available (requires Chromium-based browser)
            </div>
          )}

          {/* xterm instances */}
          <div style={SECTION}>Terminal Instances</div>
          <div style={ROW}>
            <span style={LABEL}>Active xterm instances</span>
            <span style={VALUE}>{document.querySelectorAll('.xterm').length}</span>
          </div>
          <div style={ROW}>
            <span style={LABEL}>Canvas elements</span>
            <span style={VALUE}>{document.querySelectorAll('.xterm canvas').length}</span>
          </div>

          {diag && (
            <>
              {/* Server Process */}
              <div style={SECTION}>Server Process</div>
              <div style={ROW}>
                <span style={LABEL}>Uptime</span>
                <span style={VALUE}>{fmtUptime(diag.uptimeSeconds)}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>RSS</span>
                <span style={VALUE}>{fmt(diag.serverMemory.rss)}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>Heap Used / Total</span>
                <span style={VALUE}>
                  {fmt(diag.serverMemory.heapUsed)} / {fmt(diag.serverMemory.heapTotal)}
                </span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>External + ArrayBuffers</span>
                <span style={VALUE}>
                  {fmt(diag.serverMemory.external)} + {fmt(diag.serverMemory.arrayBuffers)}
                </span>
              </div>

              {/* Resources */}
              <div style={SECTION}>Resources</div>
              <div style={ROW}>
                <span style={LABEL}>Managed PTYs</span>
                <span style={diag.managedPtys > 20 ? WARN : VALUE}>{diag.managedPtys}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>Scrollback Streams</span>
                <span style={VALUE}>{diag.scrollbackStreams}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>Known Sessions</span>
                <span style={VALUE}>{diag.knownSessions}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>Memory Buffers</span>
                <span style={VALUE}>{diag.memBuffers}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>Input Buffers</span>
                <span style={VALUE}>{diag.inputBuffers}</span>
              </div>

              {/* PubSub */}
              <div style={SECTION}>PubSub Channels</div>
              {diag.pubsubChannels.length === 0 ? (
                <div style={{ color: 'var(--muted-foreground)' }}>No active channels</div>
              ) : (
                diag.pubsubChannels.map(ch => (
                  <div key={ch.channel} style={ROW}>
                    <span style={LABEL}>{ch.channel}</span>
                    <span style={VALUE}>{ch.subscribers} subscriber{ch.subscribers !== 1 ? 's' : ''}</span>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
