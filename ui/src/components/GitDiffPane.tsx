import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  RefreshCw, ChevronDown, ChevronRight, FilePlus, FileMinus, FileCode,
  GitCommitHorizontal, GitBranch, Diff, FolderOpen, Eye, ScrollText,
} from 'lucide-react';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  content: string;
}

interface DiffHunk {
  header: string;
  context: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
}

interface Commit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  relDate: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const isMd = (name: string): boolean =>
  ['md', 'markdown', 'mdx'].includes((name ?? '').split('.').pop()?.toLowerCase() ?? '');

const isImg = (name: string): boolean =>
  ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes((name ?? '').split('.').pop()?.toLowerCase() ?? '');

const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sql: 'sql', swift: 'swift', kt: 'kotlin', php: 'php', dart: 'dart',
  md: 'markdown', mdx: 'markdown',
};
const getLang = (name: string) => EXT_LANG[(name ?? '').split('.').pop()?.toLowerCase() ?? ''] ?? 'text';

// ── Diff parser ───────────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      file = { oldPath: m ? m[1]! : '', newPath: m ? m[2]! : '', hunks: [], additions: 0, deletions: 0, isNew: false, isDeleted: false, isBinary: false };
      files.push(file!); hunk = null;
    } else if (!file) {
      continue;
    } else if (line.startsWith('new file'))     { file.isNew = true; }
    else if (line.startsWith('deleted file'))   { file.isDeleted = true; }
    else if (line.startsWith('Binary files'))   { file.isBinary = true; }
    else if (line.startsWith('--- '))           { file.oldPath = line.slice(4).replace(/^a\//, ''); }
    else if (line.startsWith('+++ '))           { file.newPath = line.slice(4).replace(/^b\//, ''); }
    else if (line.startsWith('@@ ')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (m) { hunk = { header: line.match(/@@ .* @@/)?.[0] ?? line, context: m[3]!.trim(), oldStart: +m[1]!, newStart: +m[2]!, lines: [] }; file.hunks.push(hunk); }
    } else if (hunk) {
      if (line.startsWith('+'))      { hunk.lines.push({ type: 'add', content: line.slice(1) }); file.additions++; }
      else if (line.startsWith('-')) { hunk.lines.push({ type: 'del', content: line.slice(1) }); file.deletions++; }
      else if (line.startsWith(' ') || line === '') { hunk.lines.push({ type: 'ctx', content: line.slice(1) }); }
    }
  }
  return files;
}

// ── Hunk ─────────────────────────────────────────────────────────────────────

interface HunkRow extends DiffLine {
  oldNum: number | null;
  newNum: number | null;
}

interface HunkViewProps {
  hunk: DiffHunk;
}

function HunkView({ hunk }: HunkViewProps) {
  const rows: HunkRow[] = [];
  let old = hunk.oldStart, nw = hunk.newStart;
  for (const line of hunk.lines) {
    rows.push({ ...line, oldNum: (line.type !== 'add') ? old : null, newNum: (line.type !== 'del') ? nw : null });
    if (line.type !== 'add') old++;
    if (line.type !== 'del') nw++;
  }
  return (
    <div style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, padding: '2px 12px', background: '#1b2d41', borderBottom: '1px solid #222222' }}>
        <span style={{ color: '#93C5FD', userSelect: 'none' }}>{hunk.header}</span>
        {hunk.context && <span style={{ color: '#525252' }}>{hunk.context}</span>}
      </div>
      {rows.map((row, i) => {
        const isAdd = row.type === 'add', isDel = row.type === 'del';
        return (
          <div key={i} style={{ display: 'flex', background: isAdd ? '#0d2818' : isDel ? '#2d0f0f' : 'transparent', borderBottom: '1px solid #0c0c0c' }}>
            <div style={{ width: 44, padding: '1px 8px', textAlign: 'right', color: '#525252', userSelect: 'none', flexShrink: 0, borderRight: '1px solid #222222' }}>{row.oldNum ?? ''}</div>
            <div style={{ width: 44, padding: '1px 8px', textAlign: 'right', color: '#525252', userSelect: 'none', flexShrink: 0, borderRight: '1px solid #222222' }}>{row.newNum ?? ''}</div>
            <div style={{ width: 20, padding: '1px 4px', textAlign: 'center', color: isAdd ? '#4ADE80' : isDel ? '#F87171' : '#525252', userSelect: 'none', flexShrink: 0 }}>
              {isAdd ? '+' : isDel ? '-' : ' '}
            </div>
            <pre style={{ margin: 0, padding: '1px 8px 1px 0', color: isAdd ? '#aff5b4' : isDel ? '#ffdcd7' : '#d4d4d8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
              {row.content}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

// ── File block ────────────────────────────────────────────────────────────────

interface FilePreviewProps {
  absPath: string;
}

function FilePreview({ absPath }: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const md = isMd(absPath);
  const img = isImg(absPath);

  useEffect(() => {
    if (img) return;
    fetch(`/api/fs/raw?path=${encodeURIComponent(absPath)}`)
      .then(r => r.ok ? r.text() : r.text().then(t => { throw new Error(t); }))
      .then(setContent)
      .catch((e: Error) => setError(e.message));
  }, [absPath]); // eslint-disable-line

  if (img) return <img src={`/api/fs/raw?path=${encodeURIComponent(absPath)}`} alt="" style={{ maxWidth: '100%', padding: 12 }} />;
  if (error) return <div style={{ padding: 12, color: '#F87171', fontSize: 12 }}>{error}</div>;
  if (content === null) return <div style={{ padding: 12, color: '#525252', fontSize: 12 }}>Loading…</div>;
  if (md) return (
    <div style={{ padding: '12px 20px', overflow: 'auto' }}>
      <div className="md-preview"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
    </div>
  );
  return (
    <div style={{ overflow: 'auto' }}>
      <SyntaxHighlighter
        language={getLang(absPath)}
        style={vscDarkPlus}
        showLineNumbers
        wrapLongLines
        lineNumberStyle={{ minWidth: '3em', paddingRight: 12, color: '#484f58', userSelect: 'none' }}
        customStyle={{ margin: 0, padding: '8px 0', background: '#0c0c0c', fontSize: 12, fontFamily: '"JetBrains Mono",monospace' }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

interface FileBlockProps {
  file: DiffFile;
  gitRoot: string | null;
  isFocused: boolean;
}

function FileBlock({ file, gitRoot, isFocused }: FileBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState(false);
  const displayPath = file.isDeleted ? file.oldPath : (file.newPath || file.oldPath);
  const absPath = gitRoot ? `${gitRoot}/${displayPath}` : null;

  return (
    <div data-file={displayPath} style={{ border: `1px solid ${isFocused ? '#4ADE80' : '#222222'}`, borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#111111', borderBottom: (collapsed && !preview) ? 'none' : '1px solid #222222' }}>
        <div onClick={() => setCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', userSelect: 'none', minWidth: 0 }}>
          {collapsed ? <ChevronRight size={13} color="#525252" style={{ flexShrink: 0 }} /> : <ChevronDown size={13} color="#525252" style={{ flexShrink: 0 }} />}
          {file.isNew ? <FilePlus size={13} color="#4ADE80" style={{ flexShrink: 0 }} /> : file.isDeleted ? <FileMinus size={13} color="#F87171" style={{ flexShrink: 0 }} /> : <FileCode size={13} color="#525252" style={{ flexShrink: 0 }} />}
          <span title={displayPath} style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12, color: '#F4F4F5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left', minWidth: 0 }}>
            <bdi>{displayPath}</bdi>
          </span>
        </div>
        {!file.isBinary && (
          <span title={`${file.additions} line${file.additions !== 1 ? 's' : ''} added, ${file.deletions} line${file.deletions !== 1 ? 's' : ''} removed`} style={{ fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>
            {file.additions > 0 && <span style={{ color: '#4ADE80' }}>+{file.additions}</span>}
            {file.additions > 0 && file.deletions > 0 && <span style={{ color: '#525252' }}> </span>}
            {file.deletions > 0 && <span style={{ color: '#F87171' }}>-{file.deletions}</span>}
          </span>
        )}
        {absPath && !file.isDeleted && (
          <button
            title="Toggle full file preview"
            onClick={(e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); setPreview(p => !p); setCollapsed(false); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: preview ? '#93C5FD' : '#484f58', flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <Eye size={12} />
          </button>
        )}
      </div>
      {!collapsed && (
        preview && absPath
          ? <FilePreview absPath={absPath} />
          : file.isBinary
            ? <div style={{ padding: '10px 14px', color: '#525252', fontSize: 12, fontStyle: 'italic' }}>Binary file changed</div>
            : file.hunks.map((hunk, i) => <HunkView key={i} hunk={hunk} />)
      )}
    </div>
  );
}

// ── File sidebar ──────────────────────────────────────────────────────────────

const BLOCKS = 5 as const;

interface StatBarProps {
  add: number;
  del: number;
}

function StatBar({ add, del }: StatBarProps) {
  const total = add + del || 1;
  const greenN = Math.round((add / total) * BLOCKS);
  const redN = BLOCKS - greenN;
  return (
    <span style={{ display: 'inline-flex', gap: 1, flexShrink: 0 }}>
      {Array.from({ length: greenN }).map((_, i) => <span key={`g${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: '#4ADE80', display: 'inline-block' }} />)}
      {Array.from({ length: redN }).map((_, i) => <span key={`r${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: '#F87171', display: 'inline-block' }} />)}
    </span>
  );
}

interface FileSidebarProps {
  files: DiffFile[];
  focusedIndex: number;
  onJump: (path: string) => void;
  onSelect: (index: number) => void;
  onOpenFile: ((path: string) => void) | null;
}

function FileSidebar({ files, focusedIndex, onJump, onSelect, onOpenFile }: FileSidebarProps) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  // Group files by directory, sorted alphabetically
  const grouped = (() => {
    const map = new Map<string, { file: DiffFile; index: number; name: string }[]>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const path = file.isDeleted ? file.oldPath : (file.newPath || file.oldPath);
      const parts = path.split('/');
      const name = parts.pop()!;
      const dir = parts.join('/') || '.';
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push({ file, index: i, name });
    }
    // Sort dirs alphabetically, sort files within each dir alphabetically
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, entries] of sorted) entries.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  })();

  return (
    <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid #222222', overflowY: 'auto', background: '#0c0c0c' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #222222', background: '#111111', fontSize: 11, color: '#525252', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        <span style={{ color: '#4ADE80' }}>+{totalAdd}</span>
        <span style={{ color: '#F87171' }}>-{totalDel}</span>
      </div>
      {grouped.map(([dir, entries]) => (
        <div key={dir}>
          <div style={{ padding: '5px 10px 3px', fontSize: 10, color: '#525252', fontFamily: '"JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#0c0c0c', borderBottom: '1px solid #111111', position: 'sticky', top: 0, zIndex: 1 }}>
            {dir}
          </div>
          {entries.map(({ file, index, name }) => {
            const path = file.isDeleted ? file.oldPath : (file.newPath || file.oldPath);
            const isFocused = index === focusedIndex;
            return (
              <div
                key={index}
                onClick={() => { onSelect(index); onJump(path); }}
                style={{
                  padding: '4px 10px 4px 18px', cursor: 'pointer', borderBottom: '1px solid #111111',
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: isFocused ? '#1f3a56' : 'transparent',
                  borderLeft: isFocused ? '2px solid #4ADE80' : '2px solid transparent',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { if (!isFocused) e.currentTarget.style.background = '#111111'; }}
                onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { if (!isFocused) e.currentTarget.style.background = 'transparent'; }}
              >
                {file.isNew ? <FilePlus size={11} color="#4ADE80" style={{ flexShrink: 0 }} /> : file.isDeleted ? <FileMinus size={11} color="#F87171" style={{ flexShrink: 0 }} /> : <FileCode size={11} color="#525252" style={{ flexShrink: 0 }} />}
                <span style={{ fontSize: 12, color: '#F4F4F5', fontFamily: '"JetBrains Mono",monospace', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1, minWidth: 0, direction: 'rtl', textOverflow: 'ellipsis', textAlign: 'left' }}>
                  <bdi>{name}</bdi>
                </span>
                <span title={`${file.additions} addition${file.additions !== 1 ? 's' : ''}, ${file.deletions} deletion${file.deletions !== 1 ? 's' : ''}`}>
                  <StatBar add={file.additions} del={file.deletions} />
                </span>
                {onOpenFile && (
                  <button
                    title="Open in Files tab"
                    onClick={(e) => { e.stopPropagation(); onOpenFile(path); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: '#484f58', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                    onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = '#93C5FD'; }}
                    onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = '#484f58'; }}
                  >
                    <FolderOpen size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Commit list ───────────────────────────────────────────────────────────────

interface CommitListProps {
  sessionId: string;
  base: string;
  selected: string | null;
  onSelect: (hash: string) => void;
}

function CommitList({ sessionId, base, selected, onSelect }: CommitListProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    const url = `/api/git/${encodeURIComponent(sessionId)}/log${base ? `?base=${encodeURIComponent(base)}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then((data: Commit[]) => { setCommits(data); if (data.length > 0 && !selected) onSelect(data[0]!.hash); })
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, [sessionId, base]); // eslint-disable-line

  if (loading) return <div style={{ width: 260, padding: 12, color: '#525252', fontSize: 12, borderRight: '1px solid #222222' }}>Loading…</div>;

  return (
    <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid #222222', overflowY: 'auto', background: '#0c0c0c' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #222222', background: '#111111', fontSize: 11, color: '#525252' }}>
        {commits.length} commit{commits.length !== 1 ? 's' : ''}
      </div>
      {commits.length === 0 && (
        <div style={{ padding: 12, color: '#484f58', fontSize: 12 }}>No commits ahead of base</div>
      )}
      {commits.map(c => (
        <div
          key={c.hash}
          onClick={() => onSelect(c.hash)}
          style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #111111', background: selected === c.hash ? '#1f3a56' : 'transparent' }}
          onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { if (selected !== c.hash) e.currentTarget.style.background = '#111111'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { if (selected !== c.hash) e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <GitCommitHorizontal size={11} color="#4ADE80" style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 11, color: '#93C5FD', flexShrink: 0 }}>{c.short}</span>
            <span style={{ fontSize: 10, color: '#525252', flexShrink: 0, marginLeft: 'auto' }}>{c.relDate}</span>
          </div>
          <div style={{ fontSize: 12, color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 17 }}>{c.subject}</div>
          <div style={{ fontSize: 10, color: '#525252', paddingLeft: 17 }}>{c.author}</div>
        </div>
      ))}
    </div>
  );
}

// ── Full log ──────────────────────────────────────────────────────────────────

function FullLog({ sessionId }: { sessionId: string }) {
  const [commits, setCommits] = useState<(Commit & { date: string })[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/git/${encodeURIComponent(sessionId)}/log?full=1&limit=200`)
      .then(r => r.json())
      .then(setCommits)
      .catch(() => setCommits([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div style={{ padding: 16, color: '#525252', fontSize: 12 }}>Loading…</div>;
  if (commits.length === 0) return <div style={{ padding: 16, color: '#484f58', fontSize: 12 }}>No commits</div>;

  // Group by date
  const grouped = new Map<string, typeof commits>();
  for (const c of commits) {
    const day = c.date;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(c);
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
      {[...grouped.entries()].map(([date, cs]) => (
        <div key={date}>
          <div style={{
            padding: '6px 16px', fontSize: 11, fontWeight: 600, color: '#525252',
            background: '#111111', borderBottom: '1px solid #222222',
            position: 'sticky', top: 0, zIndex: 1,
          }}>
            {date}
          </div>
          {cs.map(c => (
            <div key={c.hash} style={{ padding: '8px 16px', borderBottom: '1px solid #111111', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <GitCommitHorizontal size={13} color="#4ADE80" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#F4F4F5', marginBottom: 2 }}>{c.subject}</div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#525252' }}>
                  <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#93C5FD' }}>{c.short}</span>
                  <span>{c.author}</span>
                  <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{c.relDate}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

type ModeId = 'head' | 'branch' | 'commits' | 'log';

interface Mode {
  id: ModeId;
  icon: React.ReactNode;
  label: string;
}

const MODES = [
  { id: 'head',    icon: <Diff size={11} />,      label: 'Working tree' },
  { id: 'branch',  icon: <GitBranch size={11} />, label: 'Branch diff'  },
  { id: 'commits', icon: <GitCommitHorizontal size={11} />, label: 'Commits' },
  { id: 'log',     icon: <ScrollText size={11} />, label: 'Log' },
] as const satisfies readonly Mode[];

interface GitDiffPaneProps {
  sessionId: string | null;
  onOpenFile?: (path: string) => void;
}

export default function GitDiffPane({ sessionId, onOpenFile }: GitDiffPaneProps) {
  const [mode, setMode] = useState<ModeId>('branch');
  const [base, setBase] = useState('origin/main');
  const [editingBase, setEditingBase] = useState(false);
  const [draftBase, setDraftBase] = useState('origin/main');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitRoot, setGitRoot] = useState<string | null>(null);
  const [focusedFileIdx, setFocusedFileIdx] = useState(0);
  const diffRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/git/${encodeURIComponent(sessionId)}/root`)
      .then(r => r.json())
      .then((d: { root: string }) => setGitRoot(d.root))
      .catch(() => {});
  }, [sessionId]);

  const load = useCallback(async () => {
    if (!sessionId) return;
    if (mode === 'log') return;
    if (mode === 'commits' && !selectedCommit) return;
    setLoading(true); setError(null);
    try {
      let url = `/api/git/${encodeURIComponent(sessionId)}/diff`;
      if (mode === 'branch')  url += `?mode=branch&base=${encodeURIComponent(base)}`;
      if (mode === 'commits') url += `?mode=commit&commit=${encodeURIComponent(selectedCommit!)}`;
      const res = await fetch(url);
      const text = await res.text();
      setFiles(parseDiff(text));
    } catch (e) { setError((e as Error).message); }
    finally     { setLoading(false); }
  }, [sessionId, mode, base, selectedCommit]);

  useEffect(() => { setFiles(null); setFocusedFileIdx(0); }, [mode]);
  useEffect(() => { if (mode !== 'commits' || selectedCommit) load(); }, [load]); // eslint-disable-line
  useEffect(() => { if (files?.length) setFocusedFileIdx(0); }, [files]);

  // Auto-focus for keyboard navigation when the pane mounts
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Sorted file order (matching sidebar grouping) — maps visual position to original index
  const sortedFileOrder = useMemo(() => {
    if (!files?.length) return [];
    const entries = files.map((file, i) => {
      const path = file.isDeleted ? file.oldPath : (file.newPath || file.oldPath);
      const parts = path.split('/');
      const name = parts.pop()!;
      const dir = parts.join('/') || '.';
      return { index: i, dir, name };
    });
    entries.sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));
    return entries.map(e => e.index);
  }, [files]);

  const jumpToFile = (path: string): void => {
    const el = diffRef.current?.querySelector(`[data-file="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const navigateFile = useCallback((direction: 'prev' | 'next') => {
    if (!files?.length || !sortedFileOrder.length) return;
    setFocusedFileIdx(idx => {
      const currentPos = sortedFileOrder.indexOf(idx);
      const pos = currentPos === -1 ? 0 : currentPos;
      const nextPos = direction === 'next'
        ? Math.min(pos + 1, sortedFileOrder.length - 1)
        : Math.max(pos - 1, 0);
      const next = sortedFileOrder[nextPos]!;
      const f = files[next]!;
      const path = f.isDeleted ? f.oldPath : (f.newPath || f.oldPath);
      const el = diffRef.current?.querySelector(`[data-file="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return next;
    });
  }, [files, sortedFileOrder]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Don't capture when typing in the base branch input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    // File navigation: left/right arrows or h/l
    if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      navigateFile('next');
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'h') {
      e.preventDefault();
      navigateFile('prev');
      return;
    }

    // Scroll the diff content area: up/down arrows or j/k
    const scrollEl = diffRef.current;
    if (!scrollEl) return;
    const scrollAmount = 120;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      scrollEl.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      scrollEl.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      scrollEl.scrollBy({ top: e.shiftKey ? -200 : 200, behavior: 'smooth' });
      return;
    }

    // Page up/down
    if (e.key === 'PageDown') {
      e.preventDefault();
      scrollEl.scrollBy({ top: scrollEl.clientHeight * 0.8, behavior: 'smooth' });
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      scrollEl.scrollBy({ top: -scrollEl.clientHeight * 0.8, behavior: 'smooth' });
      return;
    }

    // Home/End — first/last file
    if (e.key === 'Home') {
      e.preventDefault();
      if (sortedFileOrder.length) setFocusedFileIdx(sortedFileOrder[0]!);
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      if (sortedFileOrder.length) setFocusedFileIdx(sortedFileOrder[sortedFileOrder.length - 1]!);
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      return;
    }

    // Refresh
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      load();
      return;
    }
  }, [files, sortedFileOrder, navigateFile, load]);

  const showSidebar = files && files.length > 0;
  const totalAdd = files?.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = files?.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#0c0c0c', outline: 'none' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #222222', background: '#111111', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Mode tabs */}
        <div style={{ display: 'flex', border: '1px solid #222222', borderRadius: 6, overflow: 'hidden' }}>
          {MODES.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '3px 9px',
                background: mode === id ? '#1f6feb' : 'none',
                color: mode === id ? '#fff' : '#737373',
                border: 'none', borderRight: id !== 'log' ? '1px solid #222222' : 'none',
                cursor: 'pointer',
              }}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {/* Base branch input (branch + commits mode) */}
        {(mode === 'branch' || mode === 'commits') && (
          editingBase ? (
            <input
              autoFocus
              value={draftBase}
              onChange={e => setDraftBase(e.target.value)}
              onBlur={() => { setEditingBase(false); setBase(draftBase); }}
              onKeyDown={e => {
                if (e.key === 'Enter') { setEditingBase(false); setBase(draftBase); }
                if (e.key === 'Escape') { setEditingBase(false); setDraftBase(base); }
              }}
              style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid #4ADE80', background: '#0c0c0c', color: '#d4d4d8', outline: 'none', width: 80, fontFamily: 'inherit' }}
            />
          ) : (
            <button
              onClick={() => { setDraftBase(base); setEditingBase(true); }}
              title="Base branch for comparison (click to change)"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid #222222', background: 'none', color: '#737373', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 9, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>vs</span>
              <GitBranch size={10} />{base}
            </button>
          )
        )}

        <div style={{ flex: 1 }} />

        {/* Stats summary */}
        {files !== null && !loading && mode !== 'commits' && (
          <span style={{ fontSize: 11, color: '#525252' }}>
            {files.length} file{files.length !== 1 ? 's' : ''}
            {totalAdd > 0 && <span style={{ color: '#4ADE80', marginLeft: 6 }}>+{totalAdd}</span>}
            {totalDel > 0 && <span style={{ color: '#F87171', marginLeft: 4 }}>-{totalDel}</span>}
          </span>
        )}

        {loading && <RefreshCw size={11} color="#525252" className="animate-spin" />}
      </div>

      {/* Body */}
      {mode === 'log' && sessionId ? (
        <FullLog sessionId={sessionId} />
      ) : (
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Commit list (commits mode) */}
        {mode === 'commits' && sessionId && (
          <CommitList sessionId={sessionId} base={base} selected={selectedCommit} onSelect={setSelectedCommit} />
        )}

        {/* File sidebar (all modes, when there are files) */}
        {showSidebar && (
          <div className="hidden md:flex flex-col" style={{ width: 240, flexShrink: 0, borderRight: '1px solid #222222' }}>
            <FileSidebar
              files={files}
              focusedIndex={focusedFileIdx}
              onJump={jumpToFile}
              onSelect={setFocusedFileIdx}
              onOpenFile={onOpenFile && gitRoot ? (relPath: string) => onOpenFile(`${gitRoot}/${relPath}`) : null}
            />
          </div>
        )}

        {/* Diff content */}
        <div ref={diffRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: mode === 'commits' && !selectedCommit ? 0 : 16 }}>
          {mode === 'commits' && !selectedCommit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 13 }}>
              Select a commit
            </div>
          )}
          {loading && <div style={{ color: '#525252', fontSize: 13 }}>Loading…</div>}
          {error   && <div style={{ color: '#F87171', fontSize: 13 }}>Error: {error}</div>}
          {!loading && files !== null && files.length === 0 && (
            <div style={{ color: '#4ADE80', fontSize: 13 }}>✓  No changes</div>
          )}
          {!loading && files?.map((file, i) => <FileBlock key={i} file={file} gitRoot={gitRoot} isFocused={i === focusedFileIdx} />)}
        </div>
      </div>
      )}
    </div>
  );
}
