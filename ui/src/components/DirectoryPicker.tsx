import { useState, useEffect, useCallback, useRef } from 'react'
import { Folder, FolderOpen, ChevronRight, ChevronUp, Loader2 } from 'lucide-react'

interface DirEntry {
  name: string
  path: string
}

interface BrowseResult {
  path: string
  parent: string
  dirs: DirEntry[]
}

interface Props {
  onSelect: (path: string) => void
  initialPath?: string
}

export default function DirectoryPicker({ onSelect, initialPath }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '~')
  const [dirs, setDirs] = useState<DirEntry[]>([])
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)

  const browse = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    setSelectedIdx(-1)
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`)
      if (!res.ok) {
        const body = await res.json()
        setError(body.error || 'Failed to browse')
        setLoading(false)
        return
      }
      const data: BrowseResult = await res.json()
      setCurrentPath(data.path)
      setParentPath(data.parent !== data.path ? data.parent : null)
      setDirs(data.dirs)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    browse(initialPath ?? '~')
  }, [browse, initialPath])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const filteredDirs = showHidden ? dirs : dirs.filter(d => !d.name.startsWith('.'))
    const total = filteredDirs.length + (parentPath ? 1 : 0)
    if (total === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIdx(i => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedIdx < 0) return
      const parentOffset = parentPath ? 1 : 0
      if (parentPath && selectedIdx === 0) {
        browse(parentPath)
      } else if (selectedIdx >= parentOffset) {
        const dir = filteredDirs[selectedIdx - parentOffset]
        if (!dir) return
        if (e.key === 'Enter') {
          onSelect(dir.path)
        } else {
          browse(dir.path)
        }
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      if (parentPath) browse(parentPath)
    }
  }, [dirs, parentPath, selectedIdx, showHidden, browse, onSelect])

  useEffect(() => {
    if (selectedIdx >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-idx="${selectedIdx}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

  const filteredDirs = showHidden ? dirs : dirs.filter(d => !d.name.startsWith('.'))
  const segments = currentPath.split('/').filter(Boolean)

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onKeyDown={handleKeyDown} onPointerDown={e => e.stopPropagation()}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-0.5 px-2 py-1 overflow-x-auto text-[11px] text-muted-foreground" style={{ scrollbarWidth: 'none' }}>
        <button className="hover:text-foreground shrink-0 px-0.5" onClick={() => browse('/')}>/</button>
        {segments.map((seg, i) => {
          const path = '/' + segments.slice(0, i + 1).join('/')
          return (
            <span key={path} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight size={9} className="text-muted-foreground/50" />
              <button
                className="hover:text-foreground px-0.5 truncate"
                style={{ maxWidth: 100 }}
                onClick={() => browse(path)}
              >{seg}</button>
            </span>
          )
        })}
      </div>

      {/* Directory list */}
      <div
        ref={listRef}
        className="overflow-y-auto"
        style={{ maxHeight: 180, minHeight: 60 }}
      >
        {loading && dirs.length === 0 && (
          <div className="flex items-center justify-center py-3 text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
          </div>
        )}
        {error && (
          <div className="px-2 py-1.5 text-[11px] text-red-400">{error}</div>
        )}
        {parentPath && (
          <button
            data-idx={0}
            className={`w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-accent text-left ${selectedIdx === 0 ? 'bg-accent' : ''}`}
            onClick={() => browse(parentPath)}
          >
            <ChevronUp size={12} className="text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">..</span>
          </button>
        )}
        {filteredDirs.map((dir, i) => {
          const idx = i + (parentPath ? 1 : 0)
          return (
            <button
              key={dir.path}
              data-idx={idx}
              className={`w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-accent text-left group ${selectedIdx === idx ? 'bg-accent' : ''}`}
              onClick={() => browse(dir.path)}
            >
              {selectedIdx === idx ? (
                <FolderOpen size={12} className="text-blue-400 shrink-0" />
              ) : (
                <Folder size={12} className="text-muted-foreground shrink-0" />
              )}
              <span className="truncate flex-1 font-mono">{dir.name}</span>
              <ChevronRight size={10} className="text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100" />
            </button>
          )
        })}
        {!loading && filteredDirs.length === 0 && !error && !parentPath && (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Empty directory</div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-2 py-1">
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={e => setShowHidden(e.target.checked)}
            className="w-3 h-3"
          />
          Hidden
        </label>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-primary text-primary-foreground hover:bg-primary/80"
          onClick={() => onSelect(currentPath)}
        >
          Open here
        </button>
      </div>
    </div>
  )
}
