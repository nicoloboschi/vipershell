import { useState, useEffect } from 'react';
import { useStats } from '../hooks/useStats.js';
import useStore from '../store.js';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.jsx';

const HISTORY = 30;
const W = 52;
const H = 16;

// ── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }) {
  if (data.length < 2) return <svg width={W} height={H} style={{ display: 'block' }} />;

  const filled = data.length < HISTORY
    ? [...Array(HISTORY - data.length).fill(null), ...data]
    : data;

  const segs = [];
  let cur = [];
  filled.forEach((v, i) => {
    if (v === null) {
      if (cur.length) { segs.push(cur); cur = []; }
    } else {
      cur.push([
        (i / (HISTORY - 1)) * W,
        H - 2 - Math.max(0, Math.min(1, v / 100)) * (H - 4),
      ]);
    }
  });
  if (cur.length) segs.push(cur);

  const id = `sg${color.replace(/[^a-z0-9]/gi, '')}`;
  const linePath = segs
    .map(seg => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(''))
    .join('');
  const last = segs[segs.length - 1] ?? [];
  const areaPath = last.length > 1
    ? [
        ...last.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`),
        `L${last[last.length - 1][0].toFixed(1)},${H}`,
        `L${last[0][0].toFixed(1)},${H}`, 'Z',
      ].join('')
    : '';

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#${id})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── StatWidget ────────────────────────────────────────────────────────────────

function StatWidget({ label, value, unit, history, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 34 }}>
        <span style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1, opacity: 0.65 }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color, fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontWeight: 600, lineHeight: 1 }}>
          {value}{unit}
        </span>
      </div>
      <Sparkline data={history} color={color} />
    </div>
  );
}

// ── ProcessList popover ───────────────────────────────────────────────────────

const MAX_CPU_BAR = 100;

function CpuBar({ pct }) {
  const w = Math.min(100, pct);
  const color = pct > 60 ? '#ff7b72' : pct > 25 ? '#d29922' : '#3fb950';
  return (
    <div style={{ width: 48, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
      <div style={{ width: `${w}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function ProcessList({ processes, sessionId }) {
  const [killing, setKilling] = useState(null); // pid being killed

  if (!processes || processes.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)', opacity: 0.6 }}>
        No child processes
      </div>
    );
  }

  const sorted = [...processes].sort((a, b) => b.cpu_percent - a.cpu_percent);

  async function handleKill(pid) {
    setKilling(pid);
    try {
      await fetch(`/api/stats/process/${pid}?session_id=${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    } finally {
      setKilling(null);
    }
  }

  return (
    <div style={{ minWidth: 300 }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 56px 48px 52px 36px',
        gap: 8, padding: '8px 14px 6px',
        fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--muted-foreground)', opacity: 0.6,
        borderBottom: '1px solid var(--border)',
      }}>
        <span>Name</span>
        <span style={{ textAlign: 'right' }}>CPU</span>
        <span style={{ textAlign: 'right' }}>Mem</span>
        <span style={{ textAlign: 'right' }}>PID</span>
        <span />
      </div>

      {/* Rows */}
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {sorted.map((p, i) => (
          <div key={p.pid} style={{
            display: 'grid', gridTemplateColumns: '1fr 56px 48px 52px 36px',
            gap: 8, padding: '5px 14px',
            alignItems: 'center',
            background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)',
          }}>
            {/* Name */}
            <span style={{
              fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
              color: 'var(--foreground)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 11,
            }}>
              {p.name}
            </span>

            {/* CPU */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
              <CpuBar pct={p.cpu_percent} />
              <span style={{
                fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                fontSize: 10, minWidth: 30, textAlign: 'right',
                color: p.cpu_percent > 60 ? '#ff7b72' : p.cpu_percent > 25 ? '#d29922' : 'var(--muted-foreground)',
              }}>
                {p.cpu_percent.toFixed(0)}%
              </span>
            </div>

            {/* Mem */}
            <span style={{
              fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
              fontSize: 10, textAlign: 'right', color: 'var(--muted-foreground)',
            }}>
              {p.mem_mb >= 1024
                ? `${(p.mem_mb / 1024).toFixed(1)}G`
                : `${p.mem_mb.toFixed(0)}M`}
            </span>

            {/* PID */}
            <span style={{
              fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
              fontSize: 10, textAlign: 'right', opacity: 0.4,
              color: 'var(--muted-foreground)',
            }}>
              {p.pid}
            </span>

            {/* Kill */}
            <button
              onClick={() => handleKill(p.pid)}
              disabled={killing === p.pid}
              title={`Kill ${p.name} (${p.pid})`}
              style={{
                fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                padding: '2px 5px', borderRadius: 3,
                background: 'none', border: '1px solid transparent',
                cursor: killing === p.pid ? 'wait' : 'pointer',
                color: '#ff7b72', opacity: killing === p.pid ? 0.4 : 0.65,
                flexShrink: 0, transition: 'opacity 0.15s, border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.borderColor = '#ff7b72'; e.currentTarget.style.background = 'rgba(255,123,114,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'none'; }}
            >
              KILL
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Separator ─────────────────────────────────────────────────────────────────

const SEP = (
  <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 8px', opacity: 0.5, flexShrink: 0 }} />
);

// ── StatChips ─────────────────────────────────────────────────────────────────

export default function StatChips() {
  const stats = useStats();
  const currentSessionId = useStore(s => s.currentSessionId);
  const [cpuH, setCpuH] = useState([]);
  const [memH, setMemH] = useState([]);

  useEffect(() => {
    setCpuH([]);
    setMemH([]);
  }, [currentSessionId]);

  useEffect(() => {
    if (!stats) return;
    setCpuH(h => [...h.slice(-(HISTORY - 1)), stats.cpu_percent]);
    setMemH(h => [...h.slice(-(HISTORY - 1)), stats.mem_percent]);
  }, [stats]);

  if (cpuH.length === 0) return null;

  const cpuVal = cpuH[cpuH.length - 1].toFixed(0);
  const memGb = stats?.mem_used_gb ?? 0;
  const memVal = memGb < 10 ? memGb.toFixed(1) : Math.round(memGb).toString();
  const processes = stats?.processes ?? null;
  const procCount = processes?.length ?? null;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <StatWidget label="CPU" value={cpuVal} unit="%" history={cpuH} color="#58a6ff" />
      {SEP}
      <StatWidget label="MEM" value={memVal} unit="G" history={memH} color="#3fb950" />

      {procCount !== null && (
        <>
          {SEP}
          <Popover>
            <PopoverTrigger asChild>
              <button
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                  borderRadius: 4,
                }}
                className="hover:bg-white/5"
                title="Show processes"
              >
                <span style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1, opacity: 0.65 }}>
                  PROC
                </span>
                <span style={{ fontSize: 13, color: '#bc8cff', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontWeight: 700, lineHeight: 1 }}>
                  {procCount}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end">
              <ProcessList processes={processes} sessionId={currentSessionId} />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
