import { useState, useEffect, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  RefreshCw, ChevronDown, ChevronRight, FilePlus, FileMinus, FileCode,
  GitCommitHorizontal, GitBranch, Diff, FolderOpen, Eye,
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
    <div style={{ fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",monospace', fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, padding: '2px 12px', background: '#1b2d41', borderBottom: '1px solid #30363d' }}>
        <span style={{ color: '#79c0ff', userSelect: 'none' }}>{hunk.header}</span>
        {hunk.context && <span style={{ color: '#6e7681' }}>{hunk.context}</span>}
      </div>
      {rows.map((row, i) => {
        const isAdd = row.type === 'add', isDel = row.type === 'del';
        return (
          <div key={i} style={{ display: 'flex', background: isAdd ? '#0d2818' : isDel ? '#2d0f0f' : 'transparent', borderBottom: '1px solid #0d1117' }}>
            <div style={{ width: 44, padding: '1px 8px', textAlign: 'right', color: '#6e7681', userSelect: 'none', flexShrink: 0, borderRight: '1px solid #30363d' }}>{row.oldNum ?? ''}</div>
            <div style={{ width: 44, padding: '1px 8px', textAlign: 'right', color: '#6e7681', userSelect: 'none', flexShrink: 0, borderRight: '1px solid #30363d' }}>{row.newNum ?? ''}</div>
            <div style={{ width: 20, padding: '1px 4px', textAlign: 'center', color: isAdd ? '#3fb950' : isDel ? '#ff7b72' : '#6e7681', userSelect: 'none', flexShrink: 0 }}>
              {isAdd ? '+' : isDel ? '-' : ' '}
            </div>
            <pre style={{ margin: 0, padding: '1px 8px 1px 0', color: isAdd ? '#aff5b4' : isDel ? '#ffdcd7' : '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
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
  if (error) return <div style={{ padding: 12, color: '#ff7b72', fontSize: 12 }}>{error}</div>;
  if (content === null) return <div style={{ padding: 12, color: '#6e7681', fontSize: 12 }}>Loading…</div>;
  if (md) return (
    <div style={{ padding: '12px 20px', overflow: 'auto' }}>
      <div className="md-preview"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div>
    </div>
  );
  return (
    <div style={{ fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",monospace', fontSize: 12, overflowX: 'auto' }}>
      {content.split('\n').map((line, i) => (
        <div key={i} style={{ display: 'flex', borderBottom: '1px solid #0d1117' }}>
          <div style={{ width: 44, padding: '1px 8px', textAlign: 'right', color: '#484f58', userSelect: 'none', flexShrink: 0, borderRight: '1px solid #30363d' }}>{i + 1}</div>
          <pre style={{ margin: 0, padding: '1px 8px', color: '#c9d1d9', whiteSpace: 'pre-wrap', wordBreak: 'break-all', flex: 1 }}>{line}</pre>
        </div>
      ))}
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
    <div data-file={displayPath} style={{ border: `1px solid ${isFocused ? '#58a6ff' : '#30363d'}`, borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#161b22', borderBottom: (collapsed && !preview) ? 'none' : '1px solid #30363d' }}>
        <div onClick={() => setCollapsed(c => !c)} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', userSelect: 'none', minWidth: 0 }}>
          {collapsed ? <ChevronRight size={13} color="#6e7681" style={{ flexShrink: 0 }} /> : <ChevronDown size={13} color="#6e7681" style={{ flexShrink: 0 }} />}
          {file.isNew ? <FilePlus size={13} color="#3fb950" style={{ flexShrink: 0 }} /> : file.isDeleted ? <FileMinus size={13} color="#ff7b72" style={{ flexShrink: 0 }} /> : <FileCode size={13} color="#6e7681" style={{ flexShrink: 0 }} />}
          <span style={{ fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontSize: 12, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayPath}
          </span>
        </div>
        {!file.isBinary && (
          <span style={{ fontFamily: 'monospace', fontSize: 12, flexShrink: 0 }}>
            {file.additions > 0 && <span style={{ color: '#3fb950' }}>+{file.additions}</span>}
            {file.additions > 0 && file.deletions > 0 && <span style={{ color: '#6e7681' }}> </span>}
            {file.deletions > 0 && <span style={{ color: '#ff7b72' }}>-{file.deletions}</span>}
          </span>
        )}
        {absPath && !file.isDeleted && (
          <button
            title="Toggle preview"
            onClick={(e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); setPreview(p => !p); setCollapsed(false); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 4px', color: preview ? '#79c0ff' : '#484f58', flexShrink: 0, display: 'flex', alignItems: 'center' }}
          >
            <Eye size={12} />
          </button>
        )}
      </div>
      {!collapsed && (
        preview && absPath
          ? <FilePreview absPath={absPath} />
          : file.isBinary
            ? <div style={{ padding: '10px 14px', color: '#6e7681', fontSize: 12, fontStyle: 'italic' }}>Binary file changed</div>
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
      {Array.from({ length: greenN }).map((_, i) => <span key={`g${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: '#3fb950', display: 'inline-block' }} />)}
      {Array.from({ length: redN }).map((_, i) => <span key={`r${i}`} style={{ width: 8, height: 8, borderRadius: 1, background: '#ff7b72', display: 'inline-block' }} />)}
    </span>
  );
}

interface FileSidebarProps {
  files: DiffFile[];
  onJump: (path: string) => void;
  onOpenFile: ((path: string) => void) | null;
}

function FileSidebar({ files, onJump, onOpenFile }: FileSidebarProps) {
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  return (
    <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid #30363d', overflowY: 'auto', background: '#0d1117' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #30363d', background: '#161b22', fontSize: 11, color: '#6e7681', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span>{files.length} file{files.length !== 1 ? 's' : ''}</span>
        <span style={{ color: '#3fb950' }}>+{totalAdd}</span>
        <span style={{ color: '#ff7b72' }}>-{totalDel}</span>
      </div>
      {files.map((file, i) => {
        const path = file.isDeleted ? file.oldPath : (file.newPath || file.oldPath);
        const name = path.split('/').pop();
        const dir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
        return (
          <div
            key={i}
            style={{ padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid #161b22', display: 'flex', flexDirection: 'column', gap: 3 }}
            onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = '#161b22'; }}
            onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatBar add={file.additions} del={file.deletions} />
              <span onClick={() => onJump(path)} style={{ fontSize: 12, color: '#e6edf3', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, cursor: 'pointer' }}>{name}</span>
              {onOpenFile && (
                <button
                  title="Open in Files"
                  onClick={() => onOpenFile(path)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: '#484f58', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                  onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = '#79c0ff'; }}
                  onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { e.currentTarget.style.color = '#484f58'; }}
                >
                  <FolderOpen size={11} />
                </button>
              )}
            </div>
            {dir && <div style={{ fontSize: 10, color: '#484f58', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 14 }}>{dir}</div>}
          </div>
        );
      })}
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

  if (loading) return <div style={{ width: 260, padding: 12, color: '#6e7681', fontSize: 12, borderRight: '1px solid #30363d' }}>Loading…</div>;

  return (
    <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid #30363d', overflowY: 'auto', background: '#0d1117' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #30363d', background: '#161b22', fontSize: 11, color: '#6e7681' }}>
        {commits.length} commit{commits.length !== 1 ? 's' : ''}
      </div>
      {commits.length === 0 && (
        <div style={{ padding: 12, color: '#484f58', fontSize: 12 }}>No commits ahead of base</div>
      )}
      {commits.map(c => (
        <div
          key={c.hash}
          onClick={() => onSelect(c.hash)}
          style={{ padding: '7px 10px', cursor: 'pointer', borderBottom: '1px solid #161b22', background: selected === c.hash ? '#1f3a56' : 'transparent' }}
          onMouseEnter={(e: React.MouseEvent<HTMLElement>) => { if (selected !== c.hash) e.currentTarget.style.background = '#161b22'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLElement>) => { if (selected !== c.hash) e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <GitCommitHorizontal size={11} color="#58a6ff" style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontSize: 11, color: '#79c0ff', flexShrink: 0 }}>{c.short}</span>
            <span style={{ fontSize: 10, color: '#6e7681', flexShrink: 0, marginLeft: 'auto' }}>{c.relDate}</span>
          </div>
          <div style={{ fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 17 }}>{c.subject}</div>
          <div style={{ fontSize: 10, color: '#6e7681', paddingLeft: 17 }}>{c.author}</div>
        </div>
      ))}
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

type ModeId = 'head' | 'branch' | 'commits';

interface Mode {
  id: ModeId;
  icon: React.ReactNode;
  label: string;
}

const MODES = [
  { id: 'head',    icon: <Diff size={11} />,      label: 'Working tree' },
  { id: 'branch',  icon: <GitBranch size={11} />, label: 'Branch diff'  },
  { id: 'commits', icon: <GitCommitHorizontal size={11} />, label: 'Commits' },
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

  const jumpToFile = (path: string): void => {
    const el = diffRef.current?.querySelector(`[data-file="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!files?.length) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setFocusedFileIdx(idx => {
      const next = e.key === 'ArrowDown'
        ? Math.min(idx + 1, files.length - 1)
        : Math.max(idx - 1, 0);
      const f = files[next]!;
      const path = f.isDeleted ? f.oldPath : (f.newPath || f.oldPath);
      const el = diffRef.current?.querySelector(`[data-file="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return next;
    });
  }, [files]);

  const showSidebar = files && files.length > 0;
  const totalAdd = files?.reduce((s, f) => s + f.additions, 0) ?? 0;
  const totalDel = files?.reduce((s, f) => s + f.deletions, 0) ?? 0;

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#0d1117', outline: 'none' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0, flexWrap: 'wrap' }}>
        {/* Mode tabs */}
        <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden' }}>
          {MODES.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, padding: '3px 9px',
                background: mode === id ? '#1f6feb' : 'none',
                color: mode === id ? '#fff' : '#8b949e',
                border: 'none', borderRight: id !== 'commits' ? '1px solid #30363d' : 'none',
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
              style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid #58a6ff', background: '#0d1117', color: '#c9d1d9', outline: 'none', width: 80, fontFamily: 'inherit' }}
            />
          ) : (
            <button
              onClick={() => { setDraftBase(base); setEditingBase(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid #30363d', background: 'none', color: '#8b949e', cursor: 'pointer' }}
            >
              <GitBranch size={10} />{base}
            </button>
          )
        )}

        <div style={{ flex: 1 }} />

        {/* Stats summary */}
        {files !== null && !loading && mode !== 'commits' && (
          <span style={{ fontSize: 11, color: '#6e7681' }}>
            {files.length} file{files.length !== 1 ? 's' : ''}
            {totalAdd > 0 && <span style={{ color: '#3fb950', marginLeft: 6 }}>+{totalAdd}</span>}
            {totalDel > 0 && <span style={{ color: '#ff7b72', marginLeft: 4 }}>-{totalDel}</span>}
          </span>
        )}

        {loading && <RefreshCw size={11} color="#6e7681" className="animate-spin" />}
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {/* Commit list (commits mode) */}
        {mode === 'commits' && sessionId && (
          <CommitList sessionId={sessionId} base={base} selected={selectedCommit} onSelect={setSelectedCommit} />
        )}

        {/* File sidebar (all modes, when there are files) */}
        {showSidebar && (
          <div className="hidden md:flex flex-col" style={{ width: 240, flexShrink: 0, borderRight: '1px solid #30363d' }}>
            <FileSidebar
              files={files}
              onJump={jumpToFile}
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
          {loading && <div style={{ color: '#6e7681', fontSize: 13 }}>Loading…</div>}
          {error   && <div style={{ color: '#ff7b72', fontSize: 13 }}>Error: {error}</div>}
          {!loading && files !== null && files.length === 0 && (
            <div style={{ color: '#3fb950', fontSize: 13 }}>✓  No changes</div>
          )}
          {!loading && files?.map((file, i) => <FileBlock key={i} file={file} gitRoot={gitRoot} isFocused={i === focusedFileIdx} />)}
        </div>
      </div>
    </div>
  );
}
