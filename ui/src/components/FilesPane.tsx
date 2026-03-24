import React, { useState, useEffect, useCallback, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Folder, FolderOpen, ChevronLeft, FileCode, FileText, Image,
  FileJson, Film, Music, Archive, File, RefreshCw, Save, Eye, Pencil, Copy, Check,
  Search, X, Filter, Upload, FolderRoot, FilePlus, FolderPlus, Trash2, ClipboardCopy,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type LucideIcon = typeof FileCode;

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

interface SearchResultData {
  file: string;
  line: number;
  text: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXT_ICONS: Record<string, LucideIcon> = {
  js: FileCode, jsx: FileCode, ts: FileCode, tsx: FileCode,
  py: FileCode, go: FileCode, rs: FileCode, java: FileCode,
  c: FileCode, cpp: FileCode, h: FileCode, rb: FileCode,
  sh: FileCode, bash: FileCode, zsh: FileCode, fish: FileCode,
  css: FileCode, scss: FileCode, html: FileCode, vue: FileCode, svelte: FileCode,
  json: FileJson, yaml: FileCode, yml: FileCode, toml: FileCode, env: FileCode,
  md: FileText, txt: FileText, rst: FileText,
  png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image, ico: Image,
  mp4: Film, mov: Film, avi: Film,
  mp3: Music, wav: Music,
  zip: Archive, tar: Archive, gz: Archive,
};

function getIcon(name: string, isDir: boolean, open: boolean = false): LucideIcon {
  if (isDir) return open ? FolderOpen : Folder;
  return EXT_ICONS[name.split('.').pop()?.toLowerCase() ?? ''] ?? File;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

const ext     = (name: string): string => (name ?? '').split('.').pop()?.toLowerCase() ?? '';

const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  css: 'css', scss: 'scss', less: 'less', html: 'html', xml: 'xml',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'docker', makefile: 'makefile',
  swift: 'swift', kt: 'kotlin', scala: 'scala', r: 'r',
  lua: 'lua', perl: 'perl', php: 'php', dart: 'dart',
  vue: 'html', svelte: 'html', astro: 'html',
  md: 'markdown', mdx: 'markdown', tex: 'latex',
  ini: 'ini', env: 'bash', conf: 'ini', cfg: 'ini',
  proto: 'protobuf', tf: 'hcl',
};
const getLang = (name: string) => EXT_LANG[ext(name)] ?? 'text';
const isImage = (name: string): boolean => ['png','jpg','jpeg','gif','webp','svg','ico','bmp'].includes(ext(name));
const isPdf   = (name: string): boolean => ext(name) === 'pdf';
const isMd    = (name: string): boolean => ['md','markdown','mdx'].includes(ext(name));
const isText  = (name: string): boolean => !isImage(name) && !isPdf(name);

// ── File list entry ───────────────────────────────────────────────────────────

const GIT_COLORS: Record<string, string> = {
  modified:  '#d29922',
  untracked: '#3fb950',
  added:     '#3fb950',
  deleted:   '#ff7b72',
  renamed:   '#d2a8ff',
};

const GIT_LABELS: Record<string, string> = {
  modified: 'M', untracked: 'U', added: 'A', deleted: 'D', renamed: 'R',
};

interface EntryProps {
  entry: Entry;
  selected: string | null;
  onSelect: (path: string) => void;
  onNavigate: (path: string) => void;
  gitStatus: Record<string, string> | null;
}

function EntryRow({ entry, selected, onSelect, onNavigate, gitStatus }: EntryProps) {
  const Icon = getIcon(entry.name, entry.isDir);
  const active = selected === entry.path;
  const status = gitStatus?.[entry.path] ?? null;

  // For directories, check if any child file has changes
  const dirHasChanges = entry.isDir && !status && gitStatus
    ? Object.keys(gitStatus).some(p => p.startsWith(entry.path + '/'))
    : false;

  const dirChangeColor = dirHasChanges ? '#d29922' : null;
  const gitColor = status ? GIT_COLORS[status] : dirChangeColor;
  const fileColor = gitColor ?? (entry.isDir ? '#c9d1d9' : '#8b949e');
  const iconColor = gitColor ?? (entry.isDir ? '#79c0ff' : '#8b949e');
  return (
    <div
      onClick={() => entry.isDir ? onNavigate(entry.path) : onSelect(entry.path)}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '4px 10px', cursor: 'pointer', userSelect: 'none',
        background: active ? '#1f3a56' : 'transparent',
        borderBottom: '1px solid #161b22',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!active) e.currentTarget.style.background = '#161b22'; }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={13} color={iconColor} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: fileColor, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: '"Cascadia Code","JetBrains Mono",monospace' }}>
        {entry.name}{entry.isDir ? '/' : ''}
      </span>
      {status && (
        <span style={{ fontSize: 9, color: gitColor ?? undefined, fontWeight: 700, flexShrink: 0, fontFamily: '"Cascadia Code","JetBrains Mono",monospace' }}>
          {GIT_LABELS[status]}
        </span>
      )}
      {dirHasChanges && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d29922', flexShrink: 0 }} />
      )}
      {!entry.isDir && entry.size > 0 && !status && (
        <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>{fmtSize(entry.size)}</span>
      )}
    </div>
  );
}

// ── Preview / editor ──────────────────────────────────────────────────────────

interface FileViewerProps {
  path: string | null;
  highlightQuery?: string | null;
  highlightLine?: number | null;
  onDelete?: () => void;
}

function FileViewer({ path, highlightQuery, highlightLine, onDelete }: FileViewerProps) {
  const [original,  setOriginal]  = useState('');
  const [content,   setContent]   = useState('');
  const [mode,      setMode]      = useState<'preview' | 'edit'>('preview');
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [saveMsg,   setSaveMsg]   = useState<string | null>(null);
  const [copied,    setCopied]    = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLTableRowElement>(null);

  const isDirty = content !== original;
  const mdFile  = isMd(path ?? '');
  const imgFile = isImage(path ?? '');
  const pdfFile = isPdf(path ?? '');
  const textFile = isText(path ?? '');

  // Load file
  useEffect(() => {
    if (!path) return;
    setError(null); setSaveMsg(null);
    setMode(highlightQuery ? 'preview' : mdFile ? 'preview' : 'edit');

    if (imgFile || pdfFile) { setContent(''); setOriginal(''); return; }

    setLoading(true);
    fetch(`/api/fs/raw?path=${encodeURIComponent(path)}`)
      .then(r => { if (!r.ok) return r.text().then(t => { throw new Error(t); }); return r.text(); })
      .then(text => { setContent(text); setOriginal(text); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]); // eslint-disable-line

  // Scroll to highlighted line after content renders
  useEffect(() => {
    if (highlightRef.current) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    }
  }, [content, highlightLine, highlightQuery]);

  const save = async () => {
    if (!path) return;
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch(`/api/fs/write?path=${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setOriginal(content);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!path) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#484f58', fontSize: 13 }}>
      Select a file to view
    </div>
  );

  const fileName = path.split('/').pop() ?? '';

  const copyPath = () => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const copyContent = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedContent(true);
      setTimeout(() => setCopiedContent(false), 1500);
    });
  };

  const deleteFile = async () => {
    if (!path) return;
    if (!window.confirm(`Delete ${path.split('/').pop()}?`)) return;
    try {
      const res = await fetch(`/api/fs/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      onDelete?.();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* File toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#8b949e', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
          {path}{isDirty ? ' \u2022' : ''}
        </span>
        <button
          onClick={copyPath}
          title="Copy path"
          style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#3fb950' : '#6e7681', padding: 2, flexShrink: 0 }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>

        {textFile && (
          <button
            onClick={copyContent}
            title="Copy file content"
            style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: copiedContent ? '#3fb950' : '#6e7681', padding: 2, flexShrink: 0 }}
          >
            {copiedContent ? <Check size={12} /> : <ClipboardCopy size={12} />}
          </button>
        )}

        <button
          onClick={deleteFile}
          title="Delete file"
          style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', padding: 2, flexShrink: 0, marginLeft: 2 }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget as HTMLButtonElement).style.color = '#ff7b72'; }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget as HTMLButtonElement).style.color = '#6e7681'; }}
        >
          <Trash2 size={12} />
        </button>

        {saveMsg && (
          <span style={{ fontSize: 11, color: saveMsg.startsWith('Error') ? '#ff7b72' : '#3fb950' }}>{saveMsg}</span>
        )}

        {/* Preview / Edit toggle — only for text files */}
        {textFile && (
          <div style={{ display: 'flex', border: '1px solid #30363d', borderRadius: 5, overflow: 'hidden' }}>
            {([
              { id: 'preview' as const, icon: <Eye size={11} />,    label: mdFile ? 'Preview' : 'View' },
              { id: 'edit' as const,    icon: <Pencil size={11} />, label: 'Edit' },
            ]).map(({ id, icon, label }) => (
              <button
                key={id}
                onClick={() => { setMode(id); if (id === 'edit') setTimeout(() => textareaRef.current?.focus(), 0); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: 11, padding: '2px 8px',
                  background: mode === id ? 'var(--accent)' : 'none',
                  color: mode === id ? 'var(--foreground)' : 'var(--muted-foreground)',
                  border: 'none', borderRight: id === 'preview' ? '1px solid #30363d' : 'none',
                  cursor: 'pointer',
                }}
              >
                {icon}{label}
              </button>
            ))}
          </div>
        )}

        {/* Save — only when editing text and dirty */}
        {textFile && mode === 'edit' && (
          <button
            onClick={save}
            disabled={saving || !isDirty}
            title="Save (\u2318S)"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 11, padding: '3px 8px', borderRadius: 5,
              background: isDirty ? '#1f6feb' : 'none',
              border: isDirty ? 'none' : '1px solid #30363d',
              color: isDirty ? '#fff' : '#484f58',
              cursor: isDirty && !saving ? 'pointer' : 'default',
            }}
          >
            <Save size={11} />{saving ? 'Saving\u2026' : 'Save'}
          </button>
        )}
      </div>

      {/* Content area */}
      {loading && <div style={{ padding: 16, color: '#6e7681', fontSize: 12 }}>Loading\u2026</div>}
      {error   && <div style={{ padding: 16, color: '#ff7b72', fontSize: 12 }}>{error}</div>}

      {!loading && !error && (
        <>
          {imgFile && (
            <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
              <img src={`/api/fs/raw?path=${encodeURIComponent(path)}`} alt={fileName} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid #30363d' }} />
            </div>
          )}

          {pdfFile && (
            <iframe src={`/api/fs/raw?path=${encodeURIComponent(path)}`} title={fileName} style={{ flex: 1, border: 'none', minHeight: 0, width: '100%' }} />
          )}

          {textFile && mode === 'edit' && (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => { if (e.key === 's' && e.metaKey) { e.preventDefault(); if (isDirty) save(); } }}
              spellCheck={false}
              style={{
                flex: 1, minHeight: 0, resize: 'none', border: 'none', outline: 'none',
                background: '#0d1117', color: '#c9d1d9', padding: '12px 16px',
                fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",monospace',
                fontSize: 13, lineHeight: 1.6, tabSize: 2,
              }}
            />
          )}

          {textFile && mode === 'preview' && !mdFile && (
            <div style={{ flex: 1, overflow: 'auto' }}>
              <SyntaxHighlighter
                language={getLang(path)}
                style={vscDarkPlus}
                showLineNumbers
                wrapLongLines
                lineNumberStyle={{ minWidth: '3em', paddingRight: 12, color: '#484f58', userSelect: 'none' }}
                customStyle={{ margin: 0, padding: '8px 0', background: '#0d1117', fontSize: 12, fontFamily: '"Cascadia Code","JetBrains Mono","Fira Code",monospace' }}
                lineProps={(lineNum) => {
                  const isTarget = highlightLine != null && lineNum === highlightLine;
                  return {
                    ref: isTarget ? highlightRef : undefined,
                    style: isTarget ? { background: 'rgba(210,153,34,0.15)', display: 'block' } : { display: 'block' },
                  };
                }}
              >
                {content}
              </SyntaxHighlighter>
            </div>
          )}

          {textFile && mode === 'preview' && mdFile && (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              <div className="md-preview">
                <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Search panel ─────────────────────────────────────────────────────────────

interface SearchResultProps {
  result: SearchResultData;
  cwd: string | null;
  isActive: boolean;
  onClick: () => void;
  query: string;
}

function SearchResult({ result, isActive, onClick, query }: SearchResultProps) {
  // Highlight matching text
  const highlightSearchText = (text: string): React.ReactNode => {
    if (!query) return text;
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let idx: number;
    const lowerQuery = query.toLowerCase();
    let key = 0;
    while ((idx = remaining.toLowerCase().indexOf(lowerQuery)) !== -1) {
      if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
      parts.push(<span key={key++} style={{ background: '#d2992240', color: '#e3b341', borderRadius: 2, padding: '0 1px' }}>{remaining.slice(idx, idx + query.length)}</span>);
      remaining = remaining.slice(idx + query.length);
    }
    if (remaining) parts.push(<span key={key++}>{remaining}</span>);
    return parts.length ? parts : text;
  };

  return (
    <div
      onClick={onClick}
      style={{
        padding: '3px 10px',
        cursor: 'pointer',
        background: isActive ? '#1f3a56' : 'transparent',
        borderBottom: '1px solid #161b22',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!isActive) e.currentTarget.style.background = '#161b22'; }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#79c0ff', fontFamily: '"Cascadia Code","JetBrains Mono",monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {result.file}
        </span>
        <span style={{ fontSize: 10, color: '#484f58', flexShrink: 0 }}>:{result.line}</span>
      </div>
      <div style={{
        fontSize: 11, color: '#8b949e', fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1,
      }}>
        {highlightSearchText(result.text.trim())}
      </div>
    </div>
  );
}

interface SearchPanelProps {
  sessionId: string | null;
  onOpenFile: (path: string, query?: string, line?: number) => void;
}

export function SearchPanel({ sessionId, onOpenFile }: SearchPanelProps) {
  const [query, setQuery]       = useState('');
  const [glob, setGlob]         = useState('');
  const [showGlob, setShowGlob] = useState(false);
  const [results, setResults]   = useState<SearchResultData[]>([]);
  const [cwd, setCwd]           = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Group results by file
  const grouped: Record<string, SearchResultData[]> = {};
  for (const r of results) {
    if (!grouped[r.file]) grouped[r.file] = [];
    grouped[r.file]!.push(r);
  }

  const doSearch = useCallback(async (q: string, g: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSearching(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (g.trim()) params.set('glob', g.trim());
      const res = await fetch(`/api/fs/${encodeURIComponent(sessionId!)}/search?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (!controller.signal.aborted) {
        setResults(data.results ?? []);
        setCwd(data.cwd ?? null);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setResults([]);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, [sessionId]);

  // Debounced search
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleInput = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val, glob), 300);
  };

  const handleGlobChange = (val: string) => {
    setGlob(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim()) timerRef.current = setTimeout(() => doSearch(query, val), 300);
  };

  // Reset when session changes
  useEffect(() => {
    setQuery(''); setGlob(''); setResults([]); setSearched(false);
    inputRef.current?.focus();
  }, [sessionId]);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const fileCount = Object.keys(grouped).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Search input */}
      <div style={{ padding: '8px 10px 4px', borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, padding: '4px 8px' }}>
          <Search size={12} style={{ color: '#6e7681', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setResults([]); setSearched(false); } }}
            placeholder="Search in files\u2026"
            spellCheck={false}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: '#c9d1d9', fontSize: 12, fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
              padding: 0,
            }}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', display: 'flex', padding: 0, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          )}
          <button
            onClick={() => setShowGlob(g => !g)}
            title="File filter (glob)"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex',
              color: showGlob || glob ? '#58a6ff' : '#6e7681',
            }}
          >
            <Filter size={12} />
          </button>
        </div>
        {showGlob && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, padding: '3px 8px' }}>
            <span style={{ fontSize: 10, color: '#6e7681', flexShrink: 0 }}>glob:</span>
            <input
              value={glob}
              onChange={e => handleGlobChange(e.target.value)}
              placeholder="e.g. *.ts, *.jsx"
              spellCheck={false}
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                color: '#c9d1d9', fontSize: 11, fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
                padding: 0,
              }}
            />
          </div>
        )}
        {searched && (
          <div style={{ fontSize: 10, color: '#6e7681', padding: '4px 0 2px', display: 'flex', gap: 6 }}>
            {searching ? (
              <span>Searching\u2026</span>
            ) : (
              <span>{results.length} result{results.length !== 1 ? 's' : ''} in {fileCount} file{fileCount !== 1 ? 's' : ''}{results.length >= 500 ? ' (limit reached)' : ''}</span>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!searched && (
          <div style={{ padding: 20, textAlign: 'center', color: '#484f58', fontSize: 12 }}>
            Type to search across files
          </div>
        )}
        {searched && !searching && results.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#484f58', fontSize: 12 }}>
            No results found
          </div>
        )}
        {Object.entries(grouped).map(([file, matches]) => (
          <div key={file}>
            <div style={{
              padding: '4px 10px', fontSize: 11, color: '#c9d1d9',
              fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
              background: '#161b22', borderBottom: '1px solid #21262d',
              display: 'flex', alignItems: 'center', gap: 6,
              position: 'sticky', top: 0, zIndex: 1,
            }}>
              <FileCode size={11} style={{ color: '#8b949e', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{file}</span>
              <span style={{ color: '#484f58', flexShrink: 0 }}>{matches.length}</span>
            </div>
            {matches.map((r, i) => (
              <SearchResult
                key={`${r.line}-${i}`}
                result={r}
                cwd={cwd}
                query={query}
                isActive={false}
                onClick={() => onOpenFile(cwd ? `${cwd}/${r.file}` : r.file, query, r.line)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

interface FilesPaneProps {
  sessionId: string | null;
  openFileRef: React.MutableRefObject<((path: string) => void | Promise<void>) | null>;
  onFileSelect?: (path: string) => void;
  highlightQuery?: string | null;
  highlightLine?: number | null;
}

export default function FilesPane({ sessionId, openFileRef, onFileSelect, highlightQuery, highlightLine }: FilesPaneProps) {
  const [dir,          setDir]          = useState<string | null>(null);
  const [entries,      setEntries]      = useState<Entry[]>([]);
  const [cwd,          setCwd]          = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('vipershell:files-sidebar-w') ?? '') || 220; } catch { return 220; }
  });
  // Mobile: 'list' | 'preview'
  const [mobileView,   setMobileView]   = useState<'list' | 'preview'>('list');
  const [gitStatus,    setGitStatus]    = useState<Record<string, string> | null>(null);
  const [isDragOver,   setIsDragOver]   = useState(false);
  const [uploadMsg,    setUploadMsg]    = useState<string | null>(null);
  const [creating,     setCreating]     = useState<'file' | 'folder' | null>(null);
  const [createName,   setCreateName]   = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);

  const browse = useCallback(async (targetPath: string | null, { autoReadme = false }: { autoReadme?: boolean } = {}) => {
    setLoading(true);
    try {
      const url = targetPath
        ? `/api/fs/${encodeURIComponent(sessionId!)}/browse?path=${encodeURIComponent(targetPath)}`
        : `/api/fs/${encodeURIComponent(sessionId!)}/browse`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDir(data.dir);
      setCwd(prev => prev ?? data.cwd);
      setEntries(data.entries);
      if (autoReadme) {
        const readme = data.entries.find((e: Entry) => !e.isDir && /^readme\.md$/i.test(e.name));
        const firstFile = data.entries.find((e: Entry) => !e.isDir);
        const toOpen = readme ?? firstFile ?? null;
        if (toOpen) setSelectedFile(toOpen.path);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || !dir) return;
    let errors = 0;
    for (const file of files) {
      try {
        const res = await fetch(
          `/api/fs/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } }
        );
        const data = await res.json();
        if (!data.ok) errors++;
      } catch { errors++; }
    }
    const msg = errors === 0
      ? (files.length === 1 ? `Uploaded ${files[0]!.name}` : `Uploaded ${files.length} files`)
      : `${errors} upload(s) failed`;
    setUploadMsg(msg);
    setTimeout(() => setUploadMsg(null), 3000);
    browse(dir);
  }, [dir, browse]);

  const onDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const w = Math.max(120, Math.min(600, startW + ev.clientX - startX));
      setSidebarWidth(w);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setSidebarWidth(w => { try { localStorage.setItem('vipershell:files-sidebar-w', String(w)); } catch {} return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  useEffect(() => { browse(null, { autoReadme: true }); setSelectedFile(null); setMobileView('list'); setGitStatus(null); }, [sessionId]); // eslint-disable-line

  // Fetch git status and refresh every 5s
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/git/${encodeURIComponent(sessionId)}/status`);
        const data = await res.json();
        if (!cancelled) setGitStatus(data.files ?? null);
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId]);

  // Expose openFile(path) to parent via ref
  useEffect(() => {
    if (!openFileRef) return;
    openFileRef.current = async (filePath: string) => {
      // Browse to the file's parent directory, then select it
      const parentDir = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : null;
      await browse(parentDir);
      setSelectedFile(filePath);
      setMobileView('preview');
      onFileSelect?.(filePath);
    };
  }, [openFileRef, browse, onFileSelect]);

  const selectFile = (path: string) => {
    setSelectedFile(path);
    setMobileView('preview');
    onFileSelect?.(path);
  };

  const startCreate = (type: 'file' | 'folder') => {
    setCreating(type);
    setCreateName('');
    setTimeout(() => createInputRef.current?.focus(), 0);
  };

  const commitCreate = async () => {
    const name = createName.trim();
    if (!name || !dir) { setCreating(null); return; }
    const fullPath = `${dir}/${name}`;
    try {
      if (creating === 'folder') {
        await fetch(`/api/fs/mkdir?path=${encodeURIComponent(fullPath)}`, { method: 'POST' });
      } else {
        await fetch(`/api/fs/write?path=${encodeURIComponent(fullPath)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '' }),
        });
      }
      await browse(dir);
      if (creating === 'file') selectFile(fullPath);
    } catch { /* ignore */ }
    setCreating(null);
  };

  const handleDelete = useCallback(() => {
    const deletedFile = selectedFile;
    setSelectedFile(null);
    setMobileView('list');
    if (dir) browse(dir);
    if (deletedFile) onFileSelect?.(null as any);
  }, [selectedFile, dir, browse, onFileSelect]);

  const breadcrumbs = dir && cwd
    ? (dir.startsWith(cwd) ? dir.slice(cwd.length) : dir).split('/').filter(Boolean)
    : [];

  const upDir = dir && cwd && dir !== cwd
    ? dir.split('/').slice(0, -1).join('/') || '/'
    : null;

  const toolbar = (showBack: boolean = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid #30363d', background: '#161b22', flexShrink: 0 }}>
      {showBack ? (
        <button onClick={() => setMobileView('list')} title="Back to files" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', padding: 2, flexShrink: 0 }}>
          <ChevronLeft size={14} />
        </button>
      ) : upDir ? (
        <button onClick={() => browse(upDir)} title="Go up" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', padding: 2, flexShrink: 0 }}>
          <ChevronLeft size={14} />
        </button>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: '"Cascadia Code","JetBrains Mono",monospace', fontSize: 11, color: '#6e7681', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {showBack
            ? (selectedFile?.split('/').pop() ?? '')
            : `~${breadcrumbs.length > 0 ? '/' + breadcrumbs.join('/') : ''}`}
        </span>
        {!showBack && cwd && dir !== cwd && (
          <button onClick={() => browse(cwd)} title="Go to project root" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#484f58', padding: 0, flexShrink: 0 }}>
            <FolderRoot size={11} />
          </button>
        )}
      </div>
      {!showBack && (
        <>
          <button onClick={() => startCreate('file')} title="New file" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', flexShrink: 0, padding: 3 }}>
            <FilePlus size={15} />
          </button>
          <button onClick={() => startCreate('folder')} title="New folder" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#6e7681', flexShrink: 0, padding: 3 }}>
            <FolderPlus size={15} />
          </button>
          <button onClick={() => browse(dir)} disabled={loading} title="Refresh" style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer', color: loading ? '#484f58' : '#6e7681', flexShrink: 0 }}>
            <RefreshCw size={11} />
          </button>
        </>
      )}
    </div>
  );

  const createInput = creating && (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px',
      background: '#1c2128', borderBottom: '1px solid #161b22',
    }}>
      {creating === 'folder'
        ? <FolderPlus size={13} color="#79c0ff" style={{ flexShrink: 0 }} />
        : <FilePlus size={13} color="#8b949e" style={{ flexShrink: 0 }} />}
      <input
        ref={createInputRef}
        value={createName}
        onChange={e => setCreateName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commitCreate();
          if (e.key === 'Escape') setCreating(null);
        }}
        onBlur={commitCreate}
        placeholder={creating === 'folder' ? 'folder name' : 'file name'}
        spellCheck={false}
        style={{
          flex: 1, border: 'none', outline: 'none', background: 'transparent',
          color: '#c9d1d9', fontSize: 12, padding: 0,
          fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
        }}
      />
    </div>
  );

  const fileList = (
    <>
      {toolbar(false)}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {createInput}
        {loading && <div style={{ padding: '8px 12px', color: '#6e7681', fontSize: 12 }}>Loading\u2026</div>}
        {!loading && entries.length === 0 && !creating && <div style={{ padding: '16px 12px', color: '#484f58', fontSize: 12, textAlign: 'center' }}>Empty directory</div>}
        {entries.map(e => (
          <EntryRow key={e.path} entry={e} selected={selectedFile} onSelect={selectFile} onNavigate={browse} gitStatus={gitStatus} />
        ))}
      </div>
    </>
  );

  const preview = (
    <>
      {toolbar(true)}
      <FileViewer path={selectedFile} highlightQuery={highlightQuery} highlightLine={highlightLine} onDelete={handleDelete} />
    </>
  );

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#0d1117', position: 'relative' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(31, 111, 235, 0.12)',
          border: '2px dashed #1f6feb',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center', color: '#58a6ff' }}>
            <Upload size={28} style={{ marginBottom: 6 }} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              Drop to upload to /{dir?.split('/').pop() ?? ''}
            </div>
          </div>
        </div>
      )}
      {uploadMsg && (
        <div style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
          padding: '6px 14px', fontSize: 12, zIndex: 40, whiteSpace: 'nowrap', pointerEvents: 'none',
          color: uploadMsg.includes('failed') ? '#ff7b72' : '#3fb950',
        }}>
          {uploadMsg}
        </div>
      )}
      {/* Mobile: single panel (list or preview) */}
      <div className="md:hidden flex flex-col flex-1 min-h-0">
        {mobileView === 'list' ? fileList : preview}
      </div>

      {/* Desktop: split layout */}
      <div className="hidden md:flex flex-col flex-1 min-h-0">
        {toolbar(false)}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: sidebarWidth, flexShrink: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            {createInput}
            {loading && <div style={{ padding: '8px 12px', color: '#6e7681', fontSize: 12 }}>Loading\u2026</div>}
            {!loading && entries.length === 0 && !creating && <div style={{ padding: '16px 12px', color: '#484f58', fontSize: 12, textAlign: 'center' }}>Empty directory</div>}
            {entries.map(e => (
              <EntryRow key={e.path} entry={e} selected={selectedFile} onSelect={setSelectedFile} onNavigate={browse} gitStatus={gitStatus} />
            ))}
            {/* Resize handle */}
            <div
              onMouseDown={onDragStart}
              style={{
                position: 'absolute', top: 0, right: 0, width: 4, height: '100%',
                cursor: 'col-resize', zIndex: 10,
                background: 'transparent',
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.background = '#58a6ff'}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!draggingRef.current) e.currentTarget.style.background = 'transparent'; }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <FileViewer path={selectedFile} highlightQuery={highlightQuery} highlightLine={highlightLine} onDelete={handleDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}
