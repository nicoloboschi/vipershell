import React, { useState, useEffect } from 'react';
import { GitBranch, GitCommitHorizontal, ArrowUp, ArrowDown, Github, GitFork, Loader2 } from 'lucide-react';
import { useStats } from '../hooks/useStats';
import { useGit, useGithubPR, useWorktrees } from '../hooks/useGit';
import useStore from '../store';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';

const HISTORY = 30;
const W = 52;
const H = 16;

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string;
  detached: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
}

export interface GithubPR {
  prUrl?: string;
  repoUrl?: string;
}

export interface StatsProcess {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
}

export interface Stats {
  cpu_percent: number;
  mem_percent: number;
  mem_used_gb: number;
  processes?: StatsProcess[];
}

interface Worktree {
  path: string;
  branch?: string;
}

interface ParsedUrl {
  favicon: string | null;
  badge: string | null;
  label: string;
  sublabel: string | null;
}

// ── Sparkline ────────────────────────────────────────────────────────────────

interface SparklineProps {
  data: (number | null)[];
  color: string;
}

function Sparkline({ data, color }: SparklineProps): React.ReactElement {
  if (data.length < 2) return <svg width={W} height={H} style={{ display: 'block' }} />;

  const filled = data.length < HISTORY
    ? [...Array(HISTORY - data.length).fill(null), ...data]
    : data;

  const segs: number[][][] = [];
  let cur: number[][] = [];
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
    .map(seg => seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`).join(''))
    .join('');
  const last = segs[segs.length - 1] ?? [];
  const areaPath = last.length > 1
    ? [
        ...last.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}`),
        `L${last[last.length - 1]![0]!.toFixed(1)},${H}`,
        `L${last[0]![0]!.toFixed(1)},${H}`, 'Z',
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

interface StatWidgetProps {
  label: string;
  value: string;
  unit: string;
  history: (number | null)[];
  color: string;
}

function StatWidget({ label, value, unit, history, color }: StatWidgetProps): React.ReactElement {
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

interface CpuBarProps {
  pct: number;
}

function CpuBar({ pct }: CpuBarProps): React.ReactElement {
  const w: number = Math.min(100, pct);
  const color: string = pct > 60 ? '#ff7b72' : pct > 25 ? '#d29922' : '#3fb950';
  return (
    <div style={{ width: 48, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
      <div style={{ width: `${w}%`, height: '100%', borderRadius: 2, background: color, transition: 'width 0.4s ease' }} />
    </div>
  );
}

interface ProcessListProps {
  processes: StatsProcess[] | null;
  sessionId: string;
}

function ProcessList({ processes, sessionId }: ProcessListProps): React.ReactElement {
  const [killing, setKilling] = useState<number | null>(null);

  if (!processes || processes.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)', opacity: 0.6 }}>
        No child processes
      </div>
    );
  }

  const sorted = [...processes].sort((a, b) => b.cpu_percent - a.cpu_percent);

  async function handleKill(pid: number): Promise<void> {
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
              onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.borderColor = '#ff7b72'; e.currentTarget.style.background = 'rgba(255,123,114,0.1)'; }}
              onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'none'; }}
            >
              KILL
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── URL list popover ──────────────────────────────────────────────────────────

const GH_PR_RE     = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const GH_ISSUE_RE  = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/;
const GH_COMMIT_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7})[0-9a-f]*/;

function parseUrl(url: string): ParsedUrl {
  let m: RegExpMatchArray | null;
  if ((m = url.match(GH_PR_RE)))     return { favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=32', badge: `#${m[3]}`,    label: `${m[1]}/${m[2]}`, sublabel: 'PR' };
  if ((m = url.match(GH_ISSUE_RE)))  return { favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=32', badge: `#${m[3]}`,    label: `${m[1]}/${m[2]}`, sublabel: 'Issue' };
  if ((m = url.match(GH_COMMIT_RE))) return { favicon: 'https://www.google.com/s2/favicons?domain=github.com&sz=32', badge: m[3] ?? null,    label: `${m[1]}/${m[2]}`, sublabel: 'Commit' };
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return {
      favicon: `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`,
      badge: null,
      label: u.hostname + (path.length > 28 ? path.slice(0, 26) + '\u2026' : path),
      sublabel: null,
    };
  } catch {
    return { favicon: null, badge: null, label: url.length > 40 ? url.slice(0, 38) + '\u2026' : url, sublabel: null };
  }
}

interface UrlListProps {
  urls: string[];
}

function UrlList({ urls }: UrlListProps): React.ReactElement {
  if (!urls || urls.length === 0) {
    return (
      <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)', opacity: 0.6 }}>
        No URLs detected
      </div>
    );
  }

  // Show newest first
  const reversed = [...urls].reverse();

  return (
    <div style={{ minWidth: 280, maxWidth: 380 }}>
      <div style={{
        padding: '7px 14px 6px',
        fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--muted-foreground)', opacity: 0.6,
        borderBottom: '1px solid var(--border)',
      }}>
        Links — {urls.length}
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {reversed.map((url, i) => {
          const { favicon, badge, label, sublabel } = parseUrl(url);
          return (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 14px',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)',
                textDecoration: 'none',
                lineHeight: 1.3,
              }}
            >
              {favicon && (
                <img
                  src={favicon}
                  width={14} height={14}
                  style={{ borderRadius: 2, flexShrink: 0, opacity: 0.85 }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              {badge ? (
                /* GitHub-style: big badge number + muted repo/type label */
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', flexShrink: 0 }}>
                    {badge}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {label}
                  </span>
                  {sublabel && (
                    <span style={{ fontSize: 9, color: 'var(--muted-foreground)', opacity: 0.5, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {sublabel}
                    </span>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Cascadia Code","JetBrains Mono",monospace' }}>
                  {label}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── GitChip ───────────────────────────────────────────────────────────────────

interface GitDetailsProps {
  git: GitStatus;
  github: GithubPR | null;
  sessionId: string;
  send: (msg: Record<string, unknown>) => void;
  prUrls?: { num: number; url: string }[];
}

function GitDetails({ git, github, sessionId, send, prUrls = [] }: GitDetailsProps): React.ReactElement {
  const Icon = git.detached ? GitCommitHorizontal : GitBranch;
  const branchColor: string = git.dirty ? '#d29922' : '#3fb950';
  const [worktrees, refreshWorktrees] = useWorktrees(sessionId);
  const [wtLoading, setWtLoading] = useState<boolean>(false);
  const [wtError, setWtError] = useState<string | null>(null);

  async function createWorktree(): Promise<void> {
    setWtLoading(true);
    setWtError(null);
    try {
      const res = await fetch(`/api/git/${encodeURIComponent(sessionId)}/worktree`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { setWtError(data.error ?? 'Failed'); return; }
      send({ type: 'create_session', path: data.path });
      refreshWorktrees();
    } catch (e) {
      setWtError(String(e));
    } finally {
      setWtLoading(false);
    }
  }

  // Build the list of PRs to show: from sessionUrls first, fall back to github hook
  const allPrs = prUrls.length > 0
    ? prUrls
    : github?.prUrl
      ? [{ num: parseInt(github.prUrl.match(/\/pull\/(\d+)/)?.[1] ?? '0', 10), url: github.prUrl }].filter(p => p.num > 0)
      : [];

  return (
    <div style={{ minWidth: 240, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon size={13} style={{ color: branchColor, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontFamily: '"Cascadia Code","JetBrains Mono",monospace', color: branchColor, fontWeight: 600 }}>
          {git.branch}
        </span>
        {git.detached && (
          <span style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6 }}>detached</span>
        )}
        {github?.repoUrl && allPrs.length === 0 && (
          <a
            href={github.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e: React.MouseEvent<HTMLElement>) => e.stopPropagation()}
            title="Open repository on GitHub"
            style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', color: 'var(--muted-foreground)', textDecoration: 'none', fontSize: 11, flexShrink: 0 }}
            className="hover:text-foreground"
          >
            <Github size={12} />
          </a>
        )}
      </div>
      {/* Pull Requests */}
      {allPrs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {allPrs.map(pr => {
            const m = pr.url.match(GH_PR_RE);
            const repo = m ? `${m[1]}/${m[2]}` : '';
            return (
              <a
                key={pr.url}
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e: React.MouseEvent<HTMLElement>) => e.stopPropagation()}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  textDecoration: 'none', padding: '3px 4px', borderRadius: 4,
                }}
                className="hover:bg-white/5"
              >
                <Github size={11} style={{ color: '#79c0ff', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#79c0ff', fontFamily: '"Cascadia Code","JetBrains Mono",monospace' }}>
                  #{pr.num}
                </span>
                {repo && (
                  <span style={{ fontSize: 10, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {repo}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--muted-foreground)' }}>
        <Row label="Status" value={git.dirty ? 'Uncommitted changes' : 'Clean'} color={git.dirty ? '#d29922' : '#3fb950'} />
        {git.ahead > 0  && <Row label="Ahead"  value={`${git.ahead} commit${git.ahead  > 1 ? 's' : ''}`} color="#58a6ff" />}
        {git.behind > 0 && <Row label="Behind" value={`${git.behind} commit${git.behind > 1 ? 's' : ''}`} color="#ff7b72" />}
        {git.ahead === 0 && git.behind === 0 && !git.detached && (
          <Row label="Remote" value="Up to date" color="var(--muted-foreground)" />
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
          <span style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.65, display: 'flex', alignItems: 'center', gap: 4 }}>
            <GitFork size={9} /> Worktrees
          </span>
          <button
            onClick={createWorktree}
            disabled={wtLoading}
            title="Create new worktree"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 18, height: 18, background: 'none', border: '1px solid var(--border)',
              borderRadius: 3, cursor: wtLoading ? 'default' : 'pointer',
              color: 'var(--muted-foreground)', opacity: wtLoading ? 0.5 : 1, flexShrink: 0,
            }}
            className="hover:bg-white/5 hover:text-foreground"
          >
            {wtLoading ? <Loader2 size={10} className="animate-spin" /> : <span style={{ fontSize: 14, lineHeight: 1, marginTop: -1 }}>+</span>}
          </button>
        </div>
        {worktrees === null && (
          <span style={{ fontSize: 10, color: 'var(--muted-foreground)', opacity: 0.5 }}>Loading\u2026</span>
        )}
        {(worktrees as Worktree[] | null)?.map((wt: Worktree) => (
          <button
            key={wt.path}
            onClick={() => send({ type: 'create_session', path: wt.path })}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
              background: 'none', border: 'none', borderRadius: 3,
              padding: '3px 4px', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)',
            }}
            className="hover:bg-white/5 hover:text-foreground"
            title={wt.path}
          >
            <GitFork size={10} style={{ flexShrink: 0, opacity: 0.6 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontFamily: '"Cascadia Code","JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wt.branch ?? wt.path.split('/').pop()}
              </span>
              <span style={{ fontSize: 9, opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wt.path}
              </span>
            </span>
          </button>
        ))}
        {wtError && <span style={{ fontSize: 10, color: '#ff7b72' }}>{wtError}</span>}
      </div>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  color: string;
}

function Row({ label, value, color }: RowProps): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontFamily: '"Cascadia Code","JetBrains Mono",monospace', color }}>{value}</span>
    </div>
  );
}

interface GitChipProps {
  sessionId: string;
  send: (msg: Record<string, unknown>) => void;
}

function extractPrUrls(urls: string[]): { num: number; url: string }[] {
  const seen = new Set<number>();
  const prs: { num: number; url: string }[] = [];
  for (const url of urls) {
    const m = url.match(GH_PR_RE);
    if (!m) continue;
    const num = parseInt(m[3]!, 10);
    if (seen.has(num)) continue;
    seen.add(num);
    prs.push({ num, url });
  }
  // Sort descending by PR number (highest first)
  prs.sort((a, b) => b.num - a.num);
  return prs;
}

function GitChip({ sessionId, send }: GitChipProps): React.ReactElement | null {
  const git = useGit(sessionId) as GitStatus | null;
  const github = useGithubPR(sessionId) as GithubPR | null;
  const sessionUrls = useStore((s: any) => s.sessionUrls?.[sessionId] ?? EMPTY_URLS) as string[];
  if (!git) return null;

  const branchColor: string = git.dirty ? '#d29922' : '#3fb950';
  // Collect PRs from session URLs (highest number first)
  const prUrls = extractPrUrls(sessionUrls);
  // Fall back to the github hook PR if no PR URLs detected in terminal output
  const topPr = prUrls[0] ?? (github?.prUrl ? { num: parseInt(github.prUrl.match(/\/pull\/(\d+)/)?.[1] ?? '0', 10), url: github.prUrl } : null);
  const extraCount = Math.max(0, prUrls.length - 1);

  return (
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
            title="Git info"
          >
            <span style={{ fontSize: 9, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1, opacity: 0.65 }}>
              GIT
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1 }}>
              <GitBranch size={9} style={{ color: branchColor, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: branchColor, fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontWeight: 600, whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
                {git.branch}
              </span>
              {git.dirty && <span style={{ fontSize: 8, color: '#d29922', fontWeight: 700 }}>{'\u25CF'}</span>}
              {git.ahead  > 0 && <span style={{ display: 'flex', alignItems: 'center', fontSize: 9, color: '#58a6ff' }}><ArrowUp size={8} strokeWidth={2.5} />{git.ahead}</span>}
              {git.behind > 0 && <span style={{ display: 'flex', alignItems: 'center', fontSize: 9, color: '#ff7b72' }}><ArrowDown size={8} strokeWidth={2.5} />{git.behind}</span>}
              {topPr && topPr.num > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, color: '#79c0ff' }}>
                  <Github size={8} strokeWidth={2} />#{topPr.num}
                  {extraCount > 0 && (
                    <span style={{ fontSize: 8, color: '#79c0ff', opacity: 0.7 }}>+{extraCount}</span>
                  )}
                </span>
              )}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="end">
          <GitDetails git={git} github={github} sessionId={sessionId} send={send} prUrls={prUrls} />
        </PopoverContent>
      </Popover>
    </>
  );
}

// ── Separator ─────────────────────────────────────────────────────────────────

const SEP: JSX.Element = (
  <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 8px', opacity: 0.5, flexShrink: 0 }} />
);

// ── StatChips ─────────────────────────────────────────────────────────────────

const EMPTY_URLS: string[] = [];

interface StatChipsProps {
  sessionId: string;
  send: (msg: Record<string, unknown>) => void;
}

export default function StatChips({ sessionId, send }: StatChipsProps): React.ReactElement {
  const stats = useStats(sessionId) as Stats | null;
  const sessionUrls = useStore((s: any) => s.sessionUrls?.[sessionId] ?? EMPTY_URLS) as string[];
  const [cpuH, setCpuH] = useState<number[]>([]);
  const [memH, setMemH] = useState<number[]>([]);

  useEffect(() => {
    setCpuH([]);
    setMemH([]);
  }, [sessionId]);

  useEffect(() => {
    if (!stats) return;
    setCpuH(h => [...h.slice(-(HISTORY - 1)), stats.cpu_percent]);
    setMemH(h => [...h.slice(-(HISTORY - 1)), stats.mem_percent]);
  }, [stats]);

  const cpuVal: string | null = cpuH.length > 0 ? cpuH[cpuH.length - 1]!.toFixed(0) : null;
  const memGb: number = stats?.mem_used_gb ?? 0;
  const memVal: string = memGb < 10 ? memGb.toFixed(1) : Math.round(memGb).toString();
  const processes: StatsProcess[] | null = stats?.processes ?? null;
  const procCount: number | null = processes?.length ?? null;

  const hasStats = cpuVal !== null;
  const hasExtra = (procCount !== null && procCount > 0) || sessionUrls.length > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <GitChip sessionId={sessionId} send={send} />
      {(hasStats || hasExtra) && (
        <>
          {SEP}
          <Popover>
            <PopoverTrigger asChild>
              <button
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                  borderRadius: 4,
                }}
                className="hover:bg-white/5"
                title="System stats"
              >
                {hasStats && (
                  <>
                    <StatWidget label="CPU" value={cpuVal!} unit="%" history={cpuH} color="#58a6ff" />
                    <StatWidget label="MEM" value={memVal} unit="G" history={memH} color="#3fb950" />
                  </>
                )}
                {sessionUrls.length > 0 && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    fontSize: 10, color: '#58a6ff',
                    fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontWeight: 600,
                  }}>
                    {sessionUrls.length} link{sessionUrls.length !== 1 ? 's' : ''}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start">
              <div style={{ minWidth: 300, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Processes */}
                {procCount !== null && procCount > 0 && (
                  <ProcessList processes={processes} sessionId={sessionId} />
                )}
                {procCount !== null && procCount > 0 && sessionUrls.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--border)' }} />
                )}
                {/* Links */}
                {sessionUrls.length > 0 && (
                  <UrlList urls={sessionUrls} />
                )}
                {/* Empty state — only if stats exist but no extras */}
                {hasStats && !hasExtra && (
                  <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--muted-foreground)', opacity: 0.6 }}>
                    No processes or links
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}
