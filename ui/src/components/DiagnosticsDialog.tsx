import { useEffect, useState } from 'react';
import ConfigDialog from './ConfigDialog';

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

interface WsClient {
  subscribedSessions: string[];
  connectedAt: number;
  messageCount: number;
  bytesSent: number;
}

interface ManagedPty {
  sessionId: string;
  pid: number;
  cols: number;
  rows: number;
}

interface Diagnostics {
  managedPtys: number;
  managedPtyDetails: ManagedPty[];
  scrollbackStreams: number;
  memBuffers: number;
  inputBuffers: number;
  knownSessions: number;
  pubsubChannels: PubsubChannel[];
  serverMemory: ServerMemory;
  uptimeSeconds: number;
  websockets: {
    totalConnections: number;
    clients: WsClient[];
  };
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

function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
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
const SUB_ROW: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '3px 0 3px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)',
  fontSize: 11,
};

interface DiagnosticsDialogProps {
  onClose: () => void;
}

export function DiagnosticsContent() {
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

  // Count browser-side resources
  const xtermCount = document.querySelectorAll('.xterm').length;
  const canvasCount = document.querySelectorAll('.xterm canvas').length;
  const wsCount = (performance as any).getEntriesByType?.('resource')?.filter?.((r: any) => r.initiatorType === 'websocket')?.length;

  return (
    <div style={{ padding: 16, overflowY: 'auto', flex: 1, fontSize: 12 }}>
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
                </div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>
              performance.memory not available (requires Chromium-based browser)
            </div>
          )}

          {/* Browser terminal instances */}
          <div style={SECTION}>Browser Terminal Instances</div>
          <div style={ROW}>
            <span style={LABEL}>Active xterm instances</span>
            <span style={xtermCount > 15 ? WARN : VALUE}>{xtermCount}</span>
          </div>
          <div style={ROW}>
            <span style={LABEL}>Canvas elements</span>
            <span style={canvasCount > 30 ? WARN : VALUE}>{canvasCount}</span>
          </div>
          <div style={ROW}>
            <span style={LABEL}>DOM nodes (total)</span>
            <span style={VALUE}>{document.querySelectorAll('*').length}</span>
          </div>

          {diag && (
            <>
              {/* WebSocket Connections */}
              <div style={SECTION}>WebSocket Connections</div>
              <div style={ROW}>
                <span style={LABEL}>Active connections</span>
                <span style={diag.websockets.totalConnections > 15 ? WARN : VALUE}>
                  {diag.websockets.totalConnections}
                </span>
              </div>
              {diag.websockets.clients.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {diag.websockets.clients.map((c, i) => (
                    <div key={i} style={SUB_ROW}>
                      <span style={LABEL}>
                        {c.subscribedSessions.length > 0
                          ? `${c.subscribedSessions.length} session${c.subscribedSessions.length > 1 ? 's' : ''}`
                          : '(no sessions)'}
                      </span>
                      <span style={{ ...VALUE, fontSize: 10 }}>
                        {c.messageCount.toLocaleString()} msgs, {fmt(c.bytesSent)}, {fmtAge(c.connectedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Server Process */}
              <div style={SECTION}>Server Process</div>
              <div style={ROW}>
                <span style={LABEL}>Uptime</span>
                <span style={VALUE}>{fmtUptime(diag.uptimeSeconds)}</span>
              </div>
              <div style={ROW}>
                <span style={LABEL}>RSS</span>
                <span style={diag.serverMemory.rss > 512 * 1024 * 1024 ? WARN : VALUE}>
                  {fmt(diag.serverMemory.rss)}
                </span>
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
              {diag.managedPtyDetails.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {diag.managedPtyDetails.map(p => (
                    <div key={p.sessionId} style={SUB_ROW}>
                      <span style={LABEL}>{p.sessionId.slice(0, 16)}</span>
                      <span style={{ ...VALUE, fontSize: 10 }}>
                        PID {p.pid}, {p.cols}x{p.rows}
                      </span>
                    </div>
                  ))}
                </div>
              )}
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
              <div style={SECTION}>PubSub Channels ({diag.pubsubChannels.length})</div>
              {diag.pubsubChannels.length === 0 ? (
                <div style={{ color: 'var(--muted-foreground)' }}>No active channels</div>
              ) : (
                <>
                  <div style={ROW}>
                    <span style={LABEL}>Total subscribers</span>
                    <span style={VALUE}>
                      {diag.pubsubChannels.reduce((sum, ch) => sum + ch.subscribers, 0)}
                    </span>
                  </div>
                  {diag.pubsubChannels.map(ch => (
                    <div key={ch.channel} style={SUB_ROW}>
                      <span style={LABEL}>{ch.channel}</span>
                      <span style={ch.subscribers > 5 ? WARN : VALUE}>
                        {ch.subscribers} sub{ch.subscribers !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
    </div>
  );
}

export default function DiagnosticsDialog({ onClose }: DiagnosticsDialogProps) {
  return (
    <ConfigDialog open onClose={onClose}>
      <DiagnosticsContent />
    </ConfigDialog>
  );
}
